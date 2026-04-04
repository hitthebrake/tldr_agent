import { useCallback, useMemo, useState } from 'react'
import {
	DefaultSizeStyle,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiToastsProvider,
	TLUiOverrides,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

// Custom tools for picking context items
const tools = [TargetShapeTool, TargetAreaTool]
const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		return {
			...tools,
			'target-area': {
				id: 'target-area',
				label: 'Pick Area',
				kbd: 'c',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-area')
				},
			},
			'target-shape': {
				id: 'target-shape',
				label: 'Pick Shape',
				kbd: 's',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-shape')
				},
			},
		}
	},
}

const CHAT_PANEL_OPEN_KEY = 'tldraw-agent-chat-panel-open'

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [chatPanelOpen, setChatPanelOpen] = useState(() => {
		try {
			const stored = localStorage.getItem(CHAT_PANEL_OPEN_KEY)
			if (stored === null) return true
			return stored === 'true'
		} catch {
			return true
		}
	})

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	const toggleChatPanel = useCallback(() => {
		setChatPanelOpen((open) => {
			const next = !open
			try {
				localStorage.setItem(CHAT_PANEL_OPEN_KEY, String(next))
			} catch {
				// ignore
			}
			return next
		})
	}, [])

	// Custom components to visualize what the agent is doing
	// These use TldrawAgentAppContextProvider to access the app/agent
	const components: TLComponents = useMemo(() => {
		return {
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons app={app} />
					</TldrawAgentAppContextProvider>
				),
			Overlays: () => (
				<>
					<TldrawOverlays />
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<AgentViewportBoundsHighlights />
							<AllContextHighlights />
						</TldrawAgentAppContextProvider>
					)}
				</>
			),
		}
	}, [app])

	return (
		<TldrawUiToastsProvider>
			<div
				className={
					'tldraw-agent-container' +
					(chatPanelOpen ? '' : ' tldraw-agent-container--chat-collapsed')
				}
			>
				<div className="tldraw-canvas">
					<Tldraw
						persistenceKey="tldraw-agent-demo"
						tools={tools}
						overrides={overrides}
						components={components}
					>
						<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
					</Tldraw>
				</div>
				<div className="chat-column">
					<ErrorBoundary fallback={ChatPanelFallback}>
						{app && (
							<TldrawAgentAppContextProvider app={app}>
								<ChatPanel />
							</TldrawAgentAppContextProvider>
						)}
					</ErrorBoundary>
				</div>
				{app && (
					<button
						type="button"
						className="chat-panel-slide-toggle"
						onClick={toggleChatPanel}
						aria-expanded={chatPanelOpen}
						aria-label={chatPanelOpen ? 'Hide chat panel' : 'Show chat panel'}
						title={chatPanelOpen ? 'Hide chat' : 'Show chat'}
					>
						{chatPanelOpen ? '›' : '‹'}
					</button>
				)}
			</div>
		</TldrawUiToastsProvider>
	)
}

export default App
