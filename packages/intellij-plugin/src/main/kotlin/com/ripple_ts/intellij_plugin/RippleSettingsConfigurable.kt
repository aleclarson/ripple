package com.ripple_ts.intellij_plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.DialogPanel
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.platform.lsp.api.LspServerManager
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.CollapsibleRow
import com.intellij.ui.dsl.builder.panel

class RippleSettingsConfigurable : SearchableConfigurable, Configurable.NoScroll {
	private var dialogPanel: DialogPanel? = null
	private var advancedGroup: CollapsibleRow? = null

	override fun getId(): String = "preferences.ripple"

	override fun getDisplayName(): String = "Ripple"

	override fun createComponent() = dialogPanel ?: createPanel().also { dialogPanel = it }

	override fun isModified(): Boolean = dialogPanel?.isModified() == true

	override fun apply() {
		dialogPanel?.apply()
	}

	override fun reset() {
		dialogPanel?.reset()
	}

	override fun disposeUIResources() {
		dialogPanel = null
		advancedGroup = null
	}

	private fun createPanel(): DialogPanel {
		val settings = RippleSettingsService.getInstance()
		val should_expand_advanced =
			settings.languageServerPath.isNotBlank() || settings.textMateBundlePath.isNotBlank()
		val runtimeField = createBrowseField(
			"Select JavaScript Runtime",
			"Choose a Node.js or Bun executable.",
		)
		val serverField = createBrowseField(
			"Select Ripple Language Server",
			"Choose a Ripple language server executable or JavaScript entry script.",
		)
		val textMateBundleField = createBrowseField(
			"Select Ripple TextMate Bundle",
			"Choose a TextMate bundle directory that contains `info.plist` and `Syntaxes/ripple.tmLanguage.json`.",
			directoryOnly = true,
		)

		return panel {
			row("JavaScript runtime executable:") {
				cell(runtimeField)
					.align(AlignX.FILL)
					.resizableColumn()
					.comment("Optional override for the Node.js or Bun executable used to run bundled or script-based Ripple language servers.")
				button("Test") {
					runValidation("Test JavaScript Runtime") {
						RippleLanguageServer.validateJavascriptRuntime(runtimeField.text)
					}
				}
			}

			advancedGroup = collapsibleGroup("Advanced settings") {
				row("Custom Ripple language server:") {
					cell(serverField)
						.align(AlignX.FILL)
						.resizableColumn()
					.comment("Optional advanced override. When set, this is always preferred over project-local, global, and bundled servers.")
					button("Test") {
						runValidation("Test Ripple Language Server") {
							RippleLanguageServer.validateCustomLanguageServer(
								serverField.text,
								runtimeField.text,
							)
						}
					}
				}

				row("Custom Ripple TextMate bundle:") {
					cell(textMateBundleField)
						.align(AlignX.FILL)
						.resizableColumn()
						.comment("Optional advanced override for the Ripple TextMate grammar bundle. The selected directory must contain `info.plist` and `Syntaxes/ripple.tmLanguage.json`. When set, this is preferred over the bundled grammar.")
					button("Test") {
						runValidation("Test Ripple TextMate Bundle") {
							RippleTextMateBundleProvider.validateBundlePath(textMateBundleField.text)
						}
					}
				}
			}.apply {
				expanded = should_expand_advanced
				packWindowHeight = true
			}

			onApply {
				val settings = RippleSettingsService.getInstance()
				val previousRuntime = settings.javascriptRuntimePath
				val previousServer = settings.languageServerPath
				val previousTextMateBundle = settings.textMateBundlePath
				val nextRuntime = runtimeField.text.trim()
				val nextServer = serverField.text.trim()
				val nextTextMateBundle = textMateBundleField.text.trim()

				settings.javascriptRuntimePath = nextRuntime
				settings.languageServerPath = nextServer
				settings.textMateBundlePath = nextTextMateBundle

				if (previousRuntime != nextRuntime || previousServer != nextServer) {
					restartLanguageServers()
				}

				if (previousTextMateBundle != nextTextMateBundle) {
					reloadTextMateBundles()
				}
			}

			onReset {
				val settings = RippleSettingsService.getInstance()
				runtimeField.text = settings.javascriptRuntimePath
				serverField.text = settings.languageServerPath
				textMateBundleField.text = settings.textMateBundlePath
				advancedGroup?.expanded =
					settings.languageServerPath.isNotBlank() || settings.textMateBundlePath.isNotBlank()
			}

			onIsModified {
				val settings = RippleSettingsService.getInstance()
				runtimeField.text.trim() != settings.javascriptRuntimePath ||
					serverField.text.trim() != settings.languageServerPath ||
					textMateBundleField.text.trim() != settings.textMateBundlePath
			}
		}
	}

	private fun createBrowseField(
		title: String,
		description: String,
		directoryOnly: Boolean = false,
	): TextFieldWithBrowseButton {
		val field = TextFieldWithBrowseButton()
		field.textField.columns = 30
		field.addBrowseFolderListener(
			title,
			description,
			null,
			if (directoryOnly) {
				FileChooserDescriptorFactory.createSingleFolderDescriptor()
			} else {
				FileChooserDescriptorFactory.createSingleFileNoJarsDescriptor()
			},
		)
		return field
	}

	private fun runValidation(title: String, validation: () -> RippleLanguageServer.ValidationResult) {
		val parent = dialogPanel ?: return
		ApplicationManager.getApplication().executeOnPooledThread {
			val result = runCatching(validation)
				.getOrElse { RippleLanguageServer.ValidationResult(false, it.message ?: "Validation failed.") }

			ApplicationManager.getApplication().invokeLater(
				{
					if (result.success) {
						Messages.showInfoMessage(parent, result.message, title)
					} else {
						Messages.showErrorDialog(parent, result.message, title)
					}
				},
				ModalityState.stateForComponent(parent),
			)
		}
	}

	private fun restartLanguageServers() {
		for (project in ProjectManager.getInstance().openProjects) {
			if (project.isDisposed) {
				continue
			}
			runCatching {
				LspServerManager.getInstance(project)
					.stopAndRestartIfNeeded(RippleLspServerSupportProvider::class.java)
			}
		}
	}

	private fun reloadTextMateBundles() {
		ApplicationManager.getApplication().executeOnPooledThread {
			RippleTextMateBundleProvider.reloadBundles()
		}
	}
}
