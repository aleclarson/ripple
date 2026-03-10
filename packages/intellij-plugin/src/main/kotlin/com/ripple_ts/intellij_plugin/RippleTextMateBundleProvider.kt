package com.ripple_ts.intellij_plugin

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import java.net.JarURLConnection
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.util.Comparator

class RippleTextMateBundleProvider : TextMateBundleProvider {
	override fun getBundles(): List<TextMateBundleProvider.PluginBundle> {
		val bundlePath = resolveBundlePath() ?: return emptyList()
		return listOf(TextMateBundleProvider.PluginBundle("Ripple", bundlePath))
	}

	private fun resolveBundlePath(): Path? {
		val configuredPath = configuredBundlePath()
		if (configuredPath != null) {
			if (isValidTextMateBundle(configuredPath)) {
				return configuredPath
			}
			LOG.warn("Configured Ripple TextMate bundle path is invalid: $configuredPath")
		}

		return ensureBundleAvailable()
	}

	private fun ensureBundleAvailable(): Path? {
		cachedBundle?.let { cached ->
			if (Files.isDirectory(cached)) {
				return cached
			}
		}

		synchronized(lock) {
			cachedBundle?.let { cached ->
				if (Files.isDirectory(cached)) {
					return cached
				}
			}

			val cacheRoot = Paths.get(PathManager.getSystemPath(), "ripple-textmate")
			val bundleDir = cacheRoot.resolve("ripple.tmbundle")
			val versionFile = cacheRoot.resolve("version.txt")
			val pluginVersion = pluginVersion()

			if (Files.isDirectory(bundleDir) && Files.isRegularFile(versionFile)) {
				val recorded = runCatching { Files.readString(versionFile) }.getOrNull()
				if (recorded == pluginVersion) {
					cachedBundle = bundleDir
					return bundleDir
				}
			}

			if (Files.exists(bundleDir)) {
				deleteRecursively(bundleDir)
			}

			val extracted = extractBundle(bundleDir)
			if (!extracted) {
				LOG.warn("Failed to extract Ripple TextMate bundle")
				return null
			}

			runCatching {
				Files.createDirectories(cacheRoot)
				Files.writeString(versionFile, pluginVersion)
			}

			cachedBundle = bundleDir
			return bundleDir
		}
	}

	private fun extractBundle(target: Path): Boolean {
		val resourceUrl = javaClass.classLoader.getResource(BUNDLE_RESOURCE_ROOT) ?: return false

		return when (resourceUrl.protocol) {
			"file" -> copyDirectory(Paths.get(resourceUrl.toURI()), target)
			"jar" -> copyFromJar(resourceUrl, target)
			else -> false
		}
	}

	private fun copyDirectory(source: Path, target: Path): Boolean {
		return runCatching {
			Files.walk(source).use { stream ->
				stream.forEach { path ->
					val relative = source.relativize(path)
					val destination = target.resolve(relative)
					if (Files.isDirectory(path)) {
						Files.createDirectories(destination)
					} else {
						Files.createDirectories(destination.parent)
						Files.copy(path, destination, StandardCopyOption.REPLACE_EXISTING)
					}
				}
			}
			true
		}.getOrElse { false }
	}

	private fun copyFromJar(resourceUrl: java.net.URL, target: Path): Boolean {
		return runCatching {
			val connection = resourceUrl.openConnection() as JarURLConnection
			val entryRoot = connection.entryName.trimEnd('/')
			connection.jarFile.use { jar ->
				val entries = jar.entries()
				while (entries.hasMoreElements()) {
					val entry = entries.nextElement()
					if (entry.isDirectory) {
						continue
					}
					if (!entry.name.startsWith("$entryRoot/")) {
						continue
					}
					val relative = entry.name.removePrefix("$entryRoot/")
					val destination = target.resolve(relative)
					Files.createDirectories(destination.parent)
					jar.getInputStream(entry).use { input ->
						Files.copy(input, destination, StandardCopyOption.REPLACE_EXISTING)
					}
				}
			}
			true
		}.getOrElse { false }
	}

	private fun deleteRecursively(path: Path) {
		Files.walk(path)
			.sorted(Comparator.reverseOrder())
			.forEach { Files.deleteIfExists(it) }
	}

	private fun pluginVersion(): String {
		val descriptor = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))
		return descriptor?.version ?: "dev"
	}

	companion object {
		private const val PLUGIN_ID = "com.ripple_ts.intellij_plugin"
		private const val BUNDLE_RESOURCE_ROOT = "textmate"
		private val LOG = Logger.getInstance(RippleTextMateBundleProvider::class.java)
		private val lock = Any()

		@Volatile
		private var cachedBundle: Path? = null

		internal fun validateBundlePath(path: String): RippleLanguageServer.ValidationResult {
			val resolved = if (path.isBlank()) {
				ensureBundledBundleForValidation()
			} else {
				resolveConfiguredBundlePath(path)
			}

			if (resolved == null || !isValidTextMateBundle(resolved)) {
				return RippleLanguageServer.ValidationResult(
					false,
					if (path.isBlank()) {
						"Ripple could not resolve the bundled TextMate bundle."
					} else {
						"Ripple could not find a valid TextMate bundle at that path. Point it at a bundle directory containing `info.plist` and `Syntaxes/ripple.tmLanguage.json`."
					},
				)
			}

			val prefix = if (path.isBlank()) "Resolved bundled TextMate bundle" else "Resolved TextMate bundle"
			return RippleLanguageServer.ValidationResult(true, "$prefix: $resolved")
		}

		internal fun reloadBundles() {
			cachedBundle = null
			runCatching {
				val serviceClass = Class.forName("org.jetbrains.plugins.textmate.TextMateService")
				val service = serviceClass.methods.firstOrNull {
					it.name == "getInstance" && it.parameterCount == 0
				}?.invoke(null) ?: run {
					@Suppress("UNCHECKED_CAST")
					ApplicationManager.getApplication().getService(serviceClass as Class<Any>)
				}

				if (service != null) {
					service.javaClass.methods.firstOrNull {
						it.name == "unregisterAllBundles" && it.parameterCount == 1
					}?.invoke(service, false)
					service.javaClass.methods.firstOrNull {
						it.name == "reloadThemesFromDisk" && it.parameterCount == 0
					}?.invoke(service)
					service.javaClass.methods.firstOrNull {
						it.name == "registerEnabledBundles" && it.parameterCount == 1
					}?.invoke(service, true)
				}
			}.onFailure {
				LOG.warn("Failed to reload Ripple TextMate bundles", it)
			}
		}

		private fun configuredBundlePath(): Path? {
			val configuredPath = RippleSettingsService.getInstance().textMateBundlePath
			return resolveConfiguredBundlePath(configuredPath)
		}

		private fun resolveConfiguredBundlePath(path: String): Path? {
			val trimmed = path.trim()
			if (trimmed.isBlank()) {
				return null
			}

			val normalized = if (trimmed.length >= 2) {
				val first = trimmed.first()
				val last = trimmed.last()
				if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
					trimmed.substring(1, trimmed.length - 1).trim()
				} else {
					trimmed
				}
			} else {
				trimmed
			}

			return runCatching {
				Paths.get(normalized).toAbsolutePath().normalize()
			}.getOrNull()
		}

		private fun ensureBundledBundleForValidation(): Path? {
			return RippleTextMateBundleProvider().ensureBundleAvailable()
		}

		private fun isValidTextMateBundle(path: Path): Boolean {
			if (!Files.isDirectory(path)) {
				return false
			}

			val hasManifest = Files.isRegularFile(path.resolve("info.plist"))
			val hasGrammar = Files.isRegularFile(path.resolve("Syntaxes").resolve("ripple.tmLanguage.json"))
			return hasManifest && hasGrammar
		}
	}
}
