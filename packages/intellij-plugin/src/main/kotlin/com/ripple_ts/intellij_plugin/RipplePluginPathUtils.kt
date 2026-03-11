package com.ripple_ts.intellij_plugin

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import java.net.JarURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.Comparator

internal object RipplePluginPathUtils {
	fun copyDirectory(source: Path, target: Path): Boolean {
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

	fun copyFromJar(resourceUrl: URL, target: Path): Boolean {
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

	fun deleteRecursively(path: Path) {
		Files.walk(path).use { stream ->
			stream
				.sorted(Comparator.reverseOrder())
				.forEach { Files.deleteIfExists(it) }
		}
	}

	fun pluginVersion(pluginId: String): String {
		val descriptor = PluginManagerCore.getPlugin(PluginId.getId(pluginId))
		return descriptor?.version ?: "dev"
	}

	fun normalizeConfiguredValue(value: String?): String? {
		val trimmed = value?.trim().orEmpty()
		if (trimmed.isBlank()) {
			return null
		}

		if (trimmed.length >= 2) {
			val first = trimmed.first()
			val last = trimmed.last()
			if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
				return trimmed.substring(1, trimmed.length - 1).trim().ifBlank { null }
			}
		}

		return trimmed
	}
}
