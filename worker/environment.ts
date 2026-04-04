export interface Environment extends Env {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string
	/** Higgsfield Cloud API key id (see https://docs.higgsfield.ai/how-to/introduction) */
	HIGGSFIELD_API_KEY?: string
	/** Higgsfield API key secret */
	HIGGSFIELD_API_SECRET?: string
}
