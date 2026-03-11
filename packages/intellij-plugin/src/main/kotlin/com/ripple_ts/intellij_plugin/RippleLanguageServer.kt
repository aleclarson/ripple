package com.ripple_ts.intellij_plugin

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.util.ExecUtil
import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.EnvironmentUtil
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.TimeUnit

internal object RippleLanguageServer {
	private const val LSP_BIN = "ripple-language-server"
	private const val FALLBACK_VERSION = "0.2.200"
	private const val PLUGIN_ID = "com.ripple_ts.intellij_plugin"
	private const val BUNDLED_SERVER_RESOURCE_ROOT = "language-server"
	private const val BUNDLED_PACKAGE_JSON_RESOURCE = "/language-server/node_modules/@ripple-ts/language-server/package.json"
	private const val CRITICAL_NOTIFICATION_GROUP = "Ripple Critical"
	private val requiredVersion: String by lazy { readBundledVersion() }
	private val VERSION_PATTERN = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
	private val ROOT_MARKERS = listOf("package.json", "pnpm-workspace.yaml", ".git")
	private val LOG = Logger.getInstance(RippleLanguageServer::class.java)
	private val bundledServerLock = Any()
	private val missingRuntimeNotifications = Collections.synchronizedMap(WeakHashMap<Project, Notification>())

	@Volatile
	private var bundledServerDir: Path? = null

	data class ServerInfo(val command: List<String>, val root: Path?)
	data class ValidationResult(val success: Boolean, val message: String)

	private val localBinaryName = if (SystemInfo.isWindows) "$LSP_BIN.cmd" else LSP_BIN

	fun resolveServer(project: Project, file: VirtualFile?): ServerInfo? {
		val startDir = file?.parent?.path?.let { Paths.get(it) } ?: project.basePath?.let { Paths.get(it) }
		val rootDir = findRoot(startDir) ?: startDir
		val configuredServer = configuredLanguageServerPath()
		if (configuredServer != null) {
			val resolved = resolveConfiguredLanguageServerCommand(configuredServer)
			if (resolved != null) {
				expireMissingRuntimeNotification(project)
				return ServerInfo(resolved, rootDir)
			}

			notifyMissingRuntime(
				project,
				"Ripple could not use the configured custom language server. Check the path in Settings | Languages & Frameworks | Ripple.",
			)
			return null
		}

		val localBinary = findLocalBinary(startDir)
		if (localBinary != null) {
			expireMissingRuntimeNotification(project)
			return ServerInfo(listOf(localBinary.toString(), "--stdio"), rootDir)
		}

		val globalBinary = findGlobalBinary()
		if (globalBinary != null) {
			expireMissingRuntimeNotification(project)
			return ServerInfo(listOf(globalBinary.toString(), "--stdio"), rootDir)
		}

		val javascriptRuntime = resolveJavascriptRuntimePath(configuredJavascriptRuntimePath()) ?: findJavascriptRuntime()
		if (javascriptRuntime == null) {
			notifyMissingRuntime(project)
			return null
		}
		expireMissingRuntimeNotification(project)

		val bundledCommand = findBundledServerCommand(javascriptRuntime)
		if (bundledCommand != null) {
			return ServerInfo(bundledCommand, rootDir)
		}

		return null
	}

	private fun findLocalBinary(startDir: Path?): Path? {
		var current = startDir
		while (current != null) {
			val nodeModules = current.resolve("node_modules")
			if (Files.isDirectory(nodeModules)) {
				val binDir = nodeModules.resolve(".bin")
				val bin = binDir.resolve(localBinaryName)
				if (Files.exists(bin)) {
					return bin
				}
			}
			current = current.parent
		}
		return null
	}

	private fun findGlobalBinary(): Path? =
		findExecutableInPath(LSP_BIN)

	private fun findBundledServerCommand(javascriptRuntime: Path): List<String>? {
		val bundledRoot = ensureBundledServerAvailable() ?: return null
		val bundledScript = resolvePath(
			bundledRoot,
			"node_modules",
			"@ripple-ts",
			"language-server",
			"bin",
			"language-server.js",
		)
		if (!Files.isRegularFile(bundledScript)) {
			LOG.warn("Bundled Ripple language server script not found at $bundledScript")
			return null
		}

		return listOf(javascriptRuntime.toString(), bundledScript.toString(), "--stdio")
	}

	private fun findJavascriptRuntime(): Path? {
		return findExecutableInPath("node")
			?: findExecutableInPath("nodejs")
			?: findExecutableInPath("bun")
	}

	internal fun validateJavascriptRuntime(runtime: String): ValidationResult {
		val resolved = if (runtime.isBlank()) findJavascriptRuntime() else resolveJavascriptRuntimePath(runtime)
		if (resolved == null) {
			return ValidationResult(
				false,
				if (runtime.isBlank()) {
					"Ripple could not auto-detect a JavaScript runtime. Install Node.js or Bun, or specify an explicit executable path."
				} else {
					"Ripple could not find that JavaScript runtime. Use an absolute path or a command available on PATH."
				},
			)
		}

		return try {
			val output = ExecUtil.execAndGetOutput(createCommandLine(listOf(resolved.toString(), "--version")))
			if (output.exitCode == 0) {
				val version = trimOutput(output.stdout + output.stderr, 1).ifBlank { "Version check succeeded." }
				val prefix = if (runtime.isBlank()) "Auto-detected runtime" else "Resolved runtime"
				ValidationResult(true, "$prefix: ${resolved}\n$version")
			} else {
				ValidationResult(
					false,
					"Runtime check failed.\n\n${trimOutput(output.stderr + output.stdout)}",
				)
			}
		} catch (ex: Exception) {
			ValidationResult(false, ex.message ?: "Runtime check failed.")
		}
	}

	internal fun validateCustomLanguageServer(server: String, runtime: String): ValidationResult {
		if (server.isBlank()) {
			return validateAutoDetectedLanguageServer(runtime)
		}

		val resolved = resolveConfiguredLanguageServerCommand(server, runtime)
		if (resolved == null) {
			return ValidationResult(
				false,
				"Ripple could not resolve that language server. Use an absolute path or a command available on PATH. JavaScript entry files also need a working Node.js or Bun runtime.",
			)
		}

		return validateLanguageServerCommand(resolved, "Resolved language server command")
	}

	private fun validateAutoDetectedLanguageServer(runtime: String): ValidationResult {
		val startDir = ProjectManager.getInstance().openProjects
			.firstNotNullOfOrNull { project -> project.basePath?.let { Paths.get(it) } }
		val localBinary = findLocalBinary(startDir)
		if (localBinary != null) {
			return validateLanguageServerCommand(
				listOf(localBinary.toString(), "--stdio"),
				"Auto-detected project-local language server",
			)
		}

		val globalBinary = findGlobalBinary()
		if (globalBinary != null) {
			return validateLanguageServerCommand(
				listOf(globalBinary.toString(), "--stdio"),
				"Auto-detected global language server",
			)
		}

		val javascriptRuntime = (if (runtime.isBlank()) findJavascriptRuntime() else resolveJavascriptRuntimePath(runtime))
			?: return ValidationResult(
				false,
				"Ripple could not auto-detect a language server because neither Node.js nor Bun is available for the bundled server.",
			)

		val bundledCommand = findBundledServerCommand(javascriptRuntime)
		if (bundledCommand != null) {
			return validateLanguageServerCommand(bundledCommand, "Auto-detected bundled language server")
		}

		return ValidationResult(
			false,
			"Ripple could not auto-detect a language server from the project, PATH, or bundled plugin resources.",
		)
	}

	private fun validateLanguageServerCommand(command: List<String>, label: String): ValidationResult {
		return try {
			val process = createCommandLine(command).createProcess()
			val exited = process.waitFor(1500, TimeUnit.MILLISECONDS)

			if (!exited && process.isAlive) {
				process.destroy()
				process.waitFor(2, TimeUnit.SECONDS)
				if (process.isAlive) {
					process.destroyForcibly()
				}
				ValidationResult(true, "$label:\n${command.joinToString(" ")}")
			} else {
				val details = trimOutput(
					process.errorStream.bufferedReader().use { it.readText() } +
						process.inputStream.bufferedReader().use { it.readText() },
				)
				ValidationResult(
					false,
					"Language server exited too early.\n\n${details.ifBlank { "Process exited with code ${process.exitValue()}." }}",
				)
			}
		} catch (ex: Exception) {
			ValidationResult(false, ex.message ?: "Language server check failed.")
		}
	}

	private fun findRoot(startDir: Path?): Path? {
		var current = startDir
		while (current != null) {
			if (hasRootMarker(current)) {
				return current
			}
			current = current.parent
		}
		return null
	}

	private fun hasRootMarker(dir: Path): Boolean {
		for (marker in ROOT_MARKERS) {
			val candidate = dir.resolve(marker)
			if (Files.exists(candidate)) {
				return true
			}
		}
		return false
	}

	private fun ensureBundledServerAvailable(): Path? {
		bundledServerDir?.let { cached ->
			if (Files.isDirectory(cached)) {
				return cached
			}
		}

		synchronized(bundledServerLock) {
			bundledServerDir?.let { cached ->
				if (Files.isDirectory(cached)) {
					return cached
				}
			}

			val cacheRoot = Paths.get(PathManager.getSystemPath(), "ripple-language-server-bundled")
			val bundleDir = cacheRoot.resolve("bundle")
			val versionFile = cacheRoot.resolve("version.txt")
			val bundleVersion = "${pluginVersion()}:${requiredVersion}"

			if (Files.isDirectory(bundleDir) && Files.isRegularFile(versionFile)) {
				val recorded = runCatching { Files.readString(versionFile).trim() }.getOrNull()
				if (recorded == bundleVersion) {
					bundledServerDir = bundleDir
					return bundleDir
				}
			}

			if (Files.exists(bundleDir)) {
				RipplePluginPathUtils.deleteRecursively(bundleDir)
			}

			val extracted = extractBundledServer(bundleDir)
			if (!extracted) {
				LOG.warn("Failed to extract bundled Ripple language server")
				return null
			}

			runCatching {
				Files.createDirectories(cacheRoot)
				Files.writeString(versionFile, bundleVersion)
			}

			bundledServerDir = bundleDir
			return bundleDir
		}
	}

	private fun extractBundledServer(target: Path): Boolean {
		val resourceUrl = RippleLanguageServer::class.java.classLoader.getResource(BUNDLED_SERVER_RESOURCE_ROOT)
			?: return false

		return when (resourceUrl.protocol) {
			"file" -> RipplePluginPathUtils.copyDirectory(Paths.get(resourceUrl.toURI()), target)
			"jar" -> RipplePluginPathUtils.copyFromJar(resourceUrl, target)
			else -> false
		}
	}

	private fun readBundledVersion(): String {
		val stream = RippleLanguageServer::class.java.getResourceAsStream(BUNDLED_PACKAGE_JSON_RESOURCE)
		if (stream == null) {
			LOG.warn("Bundled Ripple language server package.json not found: $BUNDLED_PACKAGE_JSON_RESOURCE")
			return FALLBACK_VERSION
		}

		return try {
			val content = stream.bufferedReader(Charsets.UTF_8).use { reader -> reader.readText() }
			val version = VERSION_PATTERN.find(content)?.groupValues?.getOrNull(1).orEmpty()
			version.ifBlank {
				LOG.warn("Bundled Ripple language server version was missing: $BUNDLED_PACKAGE_JSON_RESOURCE")
				FALLBACK_VERSION
			}
		} catch (ex: Exception) {
			LOG.warn("Failed to read bundled Ripple language server version", ex)
			FALLBACK_VERSION
		}
	}

	private fun findExecutableInPath(name: String): Path? {
		val pathValue = EnvironmentUtil.getValue("PATH") ?: return null
		val candidates = if (SystemInfo.isWindows) {
			listOf("$name.cmd", "$name.exe", "$name.bat", name)
		} else {
			listOf(name)
		}

		for (entry in pathValue.split(File.pathSeparatorChar)) {
			if (entry.isBlank()) {
				continue
			}
			for (candidate in candidates) {
				val path = Paths.get(entry, candidate)
				if (Files.isRegularFile(path)) {
					return path
				}
			}
		}

		return null
	}

	private fun trimOutput(output: String, maxLines: Int = 8): String {
		val lines = output.lineSequence().filter { it.isNotBlank() }.toList()
		return lines.takeLast(maxLines).joinToString("\n")
	}

	private fun notifyMissingRuntime(project: Project, message: String = defaultMissingRuntimeMessage()) {
		if (project.isDisposed) {
			return
		}

		if (missingRuntimeNotifications[project] != null) {
			return
		}

		val notification = NotificationGroupManager.getInstance()
			.getNotificationGroup(CRITICAL_NOTIFICATION_GROUP)
			.createNotification(
				"Ripple",
				message,
				NotificationType.ERROR,
			)

		missingRuntimeNotifications[project] = notification
		notification.notify(project)
	}

	private fun expireMissingRuntimeNotification(project: Project) {
		missingRuntimeNotifications.remove(project)?.expire()
	}

	private fun configuredJavascriptRuntimePath(): String? {
		return RippleSettingsService.getInstance().javascriptRuntimePath.ifBlank { null }
	}

	private fun configuredLanguageServerPath(): String? {
		return RippleSettingsService.getInstance().languageServerPath.ifBlank { null }
	}

	private fun resolveConfiguredLanguageServerCommand(server: String): List<String>? {
		return resolveConfiguredLanguageServerCommand(server, configuredJavascriptRuntimePath())
	}

	private fun resolveConfiguredLanguageServerCommand(server: String, runtime: String?): List<String>? {
		val resolvedServer = resolveConfiguredExecutable(server) ?: return null
		if (!isJavascriptFile(resolvedServer)) {
			return listOf(resolvedServer.toString(), "--stdio")
		}

		val javascriptRuntime = resolveJavascriptRuntimePath(runtime) ?: findJavascriptRuntime() ?: return null
		return listOf(javascriptRuntime.toString(), resolvedServer.toString(), "--stdio")
	}

	private fun resolveJavascriptRuntimePath(runtime: String?): Path? {
		return resolveConfiguredExecutable(runtime)
	}

	private fun resolveConfiguredExecutable(command: String?): Path? {
		val normalized = normalizeConfiguredCommand(command) ?: return null
		val explicitPath = resolveExplicitPath(normalized)
		if (explicitPath != null) {
			return explicitPath
		}

		return findExecutableInPath(normalized)
	}

	private fun normalizeConfiguredCommand(command: String?): String? {
		return RipplePluginPathUtils.normalizeConfiguredValue(command)
	}

	private fun resolveExplicitPath(command: String): Path? {
		if (!looksLikePath(command)) {
			return null
		}

		return runCatching {
			val path = Paths.get(command).toAbsolutePath().normalize()
			if (Files.isRegularFile(path)) path else null
		}.getOrNull()
	}

	private fun looksLikePath(command: String): Boolean {
		return command.contains('/') || command.contains('\\') || command.startsWith(".")
	}

	private fun resolvePath(base: Path, vararg parts: String): Path {
		var current = base
		for (part in parts) {
			current = current.resolve(part)
		}
		return current
	}

	private fun isJavascriptFile(path: Path): Boolean {
		val filename = path.fileName?.toString()?.lowercase() ?: return false
		return filename.endsWith(".js") || filename.endsWith(".cjs") || filename.endsWith(".mjs")
	}

	private fun createCommandLine(command: List<String>): GeneralCommandLine {
		val commandLine = GeneralCommandLine(command.first(), *command.drop(1).toTypedArray())
		commandLine.withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE)
		return commandLine
	}

	private fun defaultMissingRuntimeMessage(): String {
		return "Ripple could not find a project-local or global language server, and neither Node.js nor Bun is available on PATH. Install Node.js or Bun to run the bundled Ripple language server."
	}

	private fun pluginVersion(): String = RipplePluginPathUtils.pluginVersion(PLUGIN_ID)
}
