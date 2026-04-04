import { react } from 'tldraw'
import { PersistedAgentState, TldrawAgent } from '../TldrawAgent'
import { BaseAgentAppManager } from './BaseAgentAppManager'

/**
 * The fixed agent ID used in multiplayer so all users share the same agent state.
 */
const SHARED_AGENT_ID = 'agent'

/**
 * The persisted state for the entire app.
 * Contains state for all agents.
 */
export interface PersistedAppState {
	agents: Record<string, PersistedAgentState>
}

/**
 * Manager for app-level state persistence.
 *
 * In multiplayer mode, state is stored in the tldraw document meta so it is
 * automatically synced to all connected users via the existing @tldraw/sync
 * infrastructure. Remote changes are detected via editor.store.listen() and
 * applied locally with the isLoadingState guard to prevent echo saves.
 */
export class AgentAppPersistenceManager extends BaseAgentAppManager {
	/**
	 * Whether we're currently loading state to prevent premature saves.
	 */
	private isLoadingState = false

	/**
	 * Cleanup function for the agents list watcher.
	 */
	private agentsListCleanup: (() => void) | null = null

	/**
	 * Cleanup functions for per-agent state watchers, keyed by agent ID.
	 */
	private agentWatcherCleanupFns = new Map<string, () => void>()

	/**
	 * Cleanup for the remote store change listener.
	 */
	private storeListenerCleanup: (() => void) | null = null

	/**
	 * Check if state is currently being loaded.
	 */
	getIsLoadingState(): boolean {
		return this.isLoadingState
	}

	/**
	 * Serialize the current app state for persistence.
	 */
	serializeState(): PersistedAppState {
		const agents = this.app.agents.getAgents()

		return {
			agents: agents.reduce(
				(acc, agent) => {
					acc[agent.id] = agent.serializeState()
					return acc
				},
				{} as Record<string, PersistedAgentState>
			),
		}
	}

	/**
	 * Load app state from the tldraw document meta (shared across all users).
	 * Call this after the app is initialized.
	 * Creates agents for all persisted agent IDs that don't already exist.
	 */
	loadState() {
		this.isLoadingState = true

		try {
			const meta = this.app.editor.getDocumentSettings().meta
			const appState = meta?.agentState as PersistedAppState | undefined

			if (!appState) {
				// No shared state yet — ensure a default agent with a fixed ID exists
				this.app.agents.createAgent(SHARED_AGENT_ID)
				this.isLoadingState = false
				return
			}

			// Create agents for all persisted IDs (createAgent returns existing if already exists)
			for (const agentId of Object.keys(appState.agents)) {
				this.app.agents.createAgent(agentId)
			}

			// Load state for each agent
			const agents = this.app.agents.getAgents()
			agents.forEach((agent) => {
				const agentState = appState.agents[agent.id]
				if (agentState) {
					agent.loadState(agentState)
				}
			})
		} catch (e) {
			console.error('Failed to load app state:', e)
		} finally {
			this.isLoadingState = false
		}
	}

	/**
	 * Start auto-saving app state changes.
	 * Call this after loadState() to avoid saving during load.
	 * Reactively watches the agents list and all agent state.
	 * Also subscribes to remote store changes so this user's UI updates
	 * when another user sends a message or the agent responds.
	 */
	startAutoSave() {
		// Watch for changes to the agents list and set up per-agent watchers
		this.agentsListCleanup = react('agents list', () => {
			const agents = this.app.agents.getAgents()
			const currentAgentIds = new Set(agents.map((a) => a.id))

			// Set up watchers for new agents
			for (const agent of agents) {
				if (!this.agentWatcherCleanupFns.has(agent.id)) {
					const cleanup = this.createAgentStateWatcher(agent)
					this.agentWatcherCleanupFns.set(agent.id, cleanup)
				}
			}

			// Clean up watchers for removed agents
			for (const id of this.agentWatcherCleanupFns.keys()) {
				if (!currentAgentIds.has(id)) {
					const cleanup = this.agentWatcherCleanupFns.get(id)
					if (cleanup) {
						cleanup()
					}
					this.agentWatcherCleanupFns.delete(id)
				}
			}

			// Save when agent list changes (if not loading)
			if (!this.isLoadingState) {
				this.saveState()
			}
		})

		// Subscribe to remote store changes: when another user saves agent state,
		// the document meta changes with source='remote' and we reload it here.
		this.storeListenerCleanup = this.app.editor.store.listen(
			({ changes, source }) => {
				if (source !== 'remote') return
				if ('document:document' in changes.updated) {
					this.loadState()
				}
			}
		)
	}

	/**
	 * Create a reactive watcher for a single agent's state.
	 */
	private createAgentStateWatcher(agent: TldrawAgent): () => void {
		return react(`${agent.id} state`, () => {
			// Access reactive state to trigger on changes
			agent.chat.getHistory()
			agent.chatOrigin.getOrigin()
			agent.todos.getTodos()
			agent.context.getItems()
			agent.modelName.getModelName()
			agent.debug.getDebugFlags()

			// Save if not currently loading
			if (!this.isLoadingState) {
				this.saveState()
			}
		})
	}

	/**
	 * Save the current app state to the tldraw document meta.
	 * Because the document is part of the synced store, this automatically
	 * propagates to all connected users.
	 */
	private saveState() {
		const agents = this.app.agents.getAgents()
		// Don't save if no agents exist (e.g., during dispose)
		if (agents.length === 0) {
			return
		}
		const appState = this.serializeState()
		const editor = this.app.editor
		editor.updateDocumentSettings({
			meta: {
				...editor.getDocumentSettings().meta,
				agentState: JSON.parse(JSON.stringify(appState)),
			},
		})
	}

	/**
	 * Stop auto-saving and clean up watchers.
	 */
	stopAutoSave() {
		if (this.agentsListCleanup) {
			this.agentsListCleanup()
			this.agentsListCleanup = null
		}
		for (const cleanup of this.agentWatcherCleanupFns.values()) {
			cleanup()
		}
		this.agentWatcherCleanupFns.clear()
		if (this.storeListenerCleanup) {
			this.storeListenerCleanup()
			this.storeListenerCleanup = null
		}
	}

	/**
	 * Reset the manager to its initial state.
	 */
	reset() {
		this.stopAutoSave()
		this.isLoadingState = false
	}

	/**
	 * Dispose of the persistence manager.
	 */
	override dispose() {
		this.stopAutoSave()
		super.dispose()
	}
}
