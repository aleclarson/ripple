package com.ripple_ts.intellij_plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@Service(Service.Level.APP)
@State(name = "RippleSettings", storages = [Storage("ripple.xml")])
class RippleSettingsService : PersistentStateComponent<RippleSettingsService.SettingsState> {
	class SettingsState {
		var javascriptRuntimePath: String = ""
		var languageServerPath: String = ""
		var textMateBundlePath: String = ""
	}

	private var state = SettingsState()

	override fun getState(): SettingsState = state

	override fun loadState(state: SettingsState) {
		this.state = state
	}

	var javascriptRuntimePath: String
		get() = state.javascriptRuntimePath.trim()
		set(value) {
			state.javascriptRuntimePath = value.trim()
		}

	var languageServerPath: String
		get() = state.languageServerPath.trim()
		set(value) {
			state.languageServerPath = value.trim()
		}

	var textMateBundlePath: String
		get() = state.textMateBundlePath.trim()
		set(value) {
			state.textMateBundlePath = value.trim()
		}

	companion object {
		fun getInstance(): RippleSettingsService {
			return ApplicationManager.getApplication().getService(RippleSettingsService::class.java)
		}
	}
}
