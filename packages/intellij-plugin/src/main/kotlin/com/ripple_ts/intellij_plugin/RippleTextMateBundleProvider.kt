package com.ripple_ts.intellij_plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

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
			val pluginVersion = RipplePluginPathUtils.pluginVersion(PLUGIN_ID)

			if (Files.isDirectory(bundleDir) && Files.isRegularFile(versionFile)) {
				val recorded = runCatching { Files.readString(versionFile) }.getOrNull()
				if (recorded == pluginVersion) {
					cachedBundle = bundleDir
					return bundleDir
				}
			}

			if (Files.exists(bundleDir)) {
				RipplePluginPathUtils.deleteRecursively(bundleDir)
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
			"file" -> RipplePluginPathUtils.copyDirectory(Paths.get(resourceUrl.toURI()), target)
			"jar" -> RipplePluginPathUtils.copyFromJar(resourceUrl, target)
			else -> false
		}
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
			val normalized = RipplePluginPathUtils.normalizeConfiguredValue(path) ?: return null
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
