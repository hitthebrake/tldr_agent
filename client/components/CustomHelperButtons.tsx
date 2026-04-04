import {
	DefaultHelperButtons,
	DefaultHelperButtonsContent,
	TldrawUiMenuContextProvider,
} from 'tldraw'
import type { TldrawAgentApp } from '../agent/TldrawAgentApp'
import { TldrawAgentAppContextProvider } from '../agent/TldrawAgentAppProvider'
import { GoToAgentButtons } from './GoToAgentButton'

export function CustomHelperButtons({ app }: { app: TldrawAgentApp | null }) {
	return (
		<DefaultHelperButtons>
			<TldrawUiMenuContextProvider type="helper-buttons" sourceId="helper-buttons">
				<DefaultHelperButtonsContent />
				{app ? (
					<TldrawAgentAppContextProvider app={app}>
						<GoToAgentButtons />
					</TldrawAgentAppContextProvider>
				) : null}
			</TldrawUiMenuContextProvider>
		</DefaultHelperButtons>
	)
}
