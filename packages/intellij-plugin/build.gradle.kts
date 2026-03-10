plugins {
	id("java")
	id("org.jetbrains.kotlin.jvm") version "2.1.20"
	id("org.jetbrains.intellij.platform") version "2.10.2"
}

group = "com.ripple_ts.intellij_plugin"
version = "0.0.91"

val repoRoot = projectDir.resolve("../..").canonicalFile
val bundledLanguageServerDir = layout.buildDirectory.dir("generated/bundled-language-server")

val bundleLanguageServer by tasks.registering(Exec::class) {
	val outputDir = bundledLanguageServerDir.get().asFile
	workingDir = repoRoot
	commandLine(
		"pnpm",
		"exec",
		"node",
		"scripts/copy-external-deps.js",
		outputDir.absolutePath,
		"@ripple-ts/language-server",
	)
	inputs.files(
		repoRoot.resolve("pnpm-lock.yaml"),
		repoRoot.resolve("package.json"),
		repoRoot.resolve("packages/language-server/package.json"),
		repoRoot.resolve("packages/typescript-plugin/package.json"),
	)
	outputs.dir(outputDir)
	doFirst {
		delete(outputDir)
		outputDir.mkdirs()
	}
}

repositories {
	mavenCentral()
	intellijPlatform {
		defaultRepositories()
	}
}

// Read more: https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html
dependencies {
	intellijPlatform {
		webstorm("2025.2.4")
		testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)

		// Add plugin dependencies for compilation here:
		bundledPlugin("org.jetbrains.plugins.textmate")
	}
}

intellijPlatform {
	pluginConfiguration {
		ideaVersion {
			sinceBuild = "252.25557"
		}

		changeNotes = """
	            Ripple language support for IntelliJ Platform IDEs.
	        """.trimIndent()
	}
}

tasks {
	// Set the JVM compatibility versions
	withType<JavaCompile> {
		sourceCompatibility = "21"
		targetCompatibility = "21"
	}

	processResources {
		dependsOn(bundleLanguageServer)
		from(bundledLanguageServerDir) {
			into("language-server")
		}
	}
}

kotlin {
	compilerOptions {
		jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
	}
}
