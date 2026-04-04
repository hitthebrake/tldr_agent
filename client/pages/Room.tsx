import { useSync } from '@tldraw/sync'
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
	DefaultSizeStyle,
	DefaultToolbar,
	Editor,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiToastsProvider,
	TLUiOverrides,
} from 'tldraw'
import { TldrawAgentApp } from '../agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from '../agent/TldrawAgentAppProvider'
import { AgentSharePanel } from '../components/AgentSharePanel'
import { ChatPanel } from '../components/ChatPanel'
import { HiggsfieldGenerationOverlay } from '../components/HiggsfieldGenerationOverlay'
import { RoomToolbarContent } from '../components/RoomToolbarContent'
import { ChatPanelFallback } from '../components/ChatPanelFallback'
import { CustomHelperButtons } from '../components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from '../components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from '../components/highlights/ContextHighlights'
import { TargetAreaTool } from '../tools/TargetAreaTool'
import { TargetShapeTool } from '../tools/TargetShapeTool'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'

DefaultSizeStyle.setDefaultValue('s')

const tools = [TargetShapeTool, TargetAreaTool]
const overrides: TLUiOverrides = {
	tools: (editor, tools) => ({
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
	}),
}

// Minimum and maximum chat panel widths in px
const MIN_CHAT_WIDTH = 240
const MAX_CHAT_WIDTH = 640
const DEFAULT_CHAT_WIDTH = 350

export function Room() {
	const { roomId } = useParams<{ roomId: string }>()

	const store = useSync({
		uri: `${window.location.origin}/api/connect/${roomId}`,
		assets: multiplayerAssetStore,
	})

	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [agentActive, setAgentActive] = useState(false)
	const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH)
	const editorRef = useRef<Editor | null>(null)
	const isResizing = useRef(false)

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	// ── Toggle the agent (writes to document meta → synced to all users) ──
	const handleToggleAgent = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		const next = !agentActive
		editor.updateDocumentSettings({
			meta: { ...editor.getDocumentSettings().meta, agentActive: next },
		})
		setAgentActive(next)
	}, [agentActive])

	// ── Resize handle drag ──
	const handleResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			isResizing.current = true
			const startX = e.clientX
			const startWidth = chatWidth

			const onMouseMove = (e: MouseEvent) => {
				if (!isResizing.current) return
				const delta = startX - e.clientX // dragging left = wider chat
				const next = Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, startWidth + delta))
				setChatWidth(next)
			}
			const onMouseUp = () => {
				isResizing.current = false
				window.removeEventListener('mousemove', onMouseMove)
				window.removeEventListener('mouseup', onMouseUp)
			}
			window.addEventListener('mousemove', onMouseMove)
			window.addEventListener('mouseup', onMouseUp)
		},
		[chatWidth]
	)

	const components: TLComponents = useMemo(
		() => ({
			SharePanel: AgentSharePanel,
			Toolbar: () => (
				<DefaultToolbar>
					<RoomToolbarContent />
				</DefaultToolbar>
			),
			HelperButtons: () => <CustomHelperButtons app={app} />,
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
		}),
		[app]
	)

	return (
		<RoomWrapper roomId={roomId} agentActive={agentActive} onToggleAgent={handleToggleAgent}>
			<TldrawUiToastsProvider>
				<div
					className="tldraw-agent-container"
					style={
						agentActive
							? { gridTemplateColumns: `1fr 5px ${chatWidth}px` }
							: { gridTemplateColumns: '1fr' }
					}
				>
					<div className="tldraw-canvas">
						<Tldraw
							store={store}
							options={{ deepLinks: true }}
							tools={tools}
							overrides={overrides}
							components={components}
							onMount={(editor) => {
								editor.registerExternalAssetHandler('url', getBookmarkPreview)
								editorRef.current = editor
								const initial = !!(editor.getDocumentSettings().meta?.agentActive)
								setAgentActive(initial)
								const cleanup = editor.store.listen(({ changes, source }) => {
									if (source !== 'remote') return
									if ('document:document' in changes.updated) {
										const active = !!(editor.getDocumentSettings().meta?.agentActive)
										setAgentActive(active)
									}
								})
								return cleanup
							}}
						>
							<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
						</Tldraw>
						<HiggsfieldGenerationOverlay />
					</div>

					{agentActive && (
						<div
							className="chat-resize-handle"
							onMouseDown={handleResizeMouseDown}
							title="Drag to resize"
						/>
					)}

					{agentActive && (
						<ErrorBoundary fallback={ChatPanelFallback}>
							{app ? (
								<TldrawAgentAppContextProvider app={app}>
									<ChatPanel />
								</TldrawAgentAppContextProvider>
							) : (
								<div className="chat-panel tl-theme__dark" />
							)}
						</ErrorBoundary>
					)}
				</div>
			</TldrawUiToastsProvider>
		</RoomWrapper>
	)
}

// ── RoomWrapper ────────────────────────────────────────────────────────────────

function RoomWrapper({
	children,
	roomId,
	agentActive,
	onToggleAgent,
}: {
	children: ReactNode
	roomId?: string
	agentActive: boolean
	onToggleAgent: () => void
}) {
	const [didCopy, setDidCopy] = useState(false)

	useEffect(() => {
		if (!didCopy) return
		const timeout = setTimeout(() => setDidCopy(false), 3000)
		return () => clearTimeout(timeout)
	}, [didCopy])

	return (
		<div className="RoomWrapper">
			<div className="RoomWrapper-header">
				<WifiIcon />
				<div>{roomId}</div>
				<button
					className="RoomWrapper-copy"
					onClick={() => {
						navigator.clipboard.writeText(window.location.href)
						setDidCopy(true)
					}}
					aria-label="copy room link"
				>
					Copy link
					{didCopy && <div className="RoomWrapper-copied">Copied!</div>}
				</button>

				{/* Spacer pushes agent button to the right */}
				<div style={{ flex: 1 }} />

				<button
					className={`agent-toggle-btn ${agentActive ? 'agent-toggle-btn--active' : ''}`}
					onClick={onToggleAgent}
					title={agentActive ? 'Remove AI Agent' : 'Add AI Agent'}
				>
					<span className="agent-toggle-btn-icon">✦</span>
					{agentActive ? (
						<>
							<span className="agent-toggle-btn-online-dot" />
							<span>AI Agent</span>
							<span className="agent-toggle-btn-remove">✕</span>
						</>
					) : (
						<span>Add AI Agent</span>
					)}
				</button>
			</div>
			<div className="RoomWrapper-content">{children}</div>
		</div>
	)
}

function WifiIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth="1.5"
			stroke="currentColor"
			width={16}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z"
			/>
		</svg>
	)
}
