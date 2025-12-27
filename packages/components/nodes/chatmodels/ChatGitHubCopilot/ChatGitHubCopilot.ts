import { ChatOpenAI as LangchainChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import { BaseCache } from '@langchain/core/caches'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'
const DEFAULT_BASE_URL = 'https://api.githubcopilot.com'
const TOKEN_REFRESH_BUFFER_SECONDS = 300
const COPILOT_MODEL_LIST_PATH = '/models'
const COPILOT_MODEL_CACHE_TTL_MS = 15 * 60 * 1000

const COPILOT_HEADERS = {
    'Editor-Version': 'vscode/1.96.2',
    'Editor-Plugin-Version': 'copilot-chat/0.23.1',
    'User-Agent': 'GithubCopilot/1.255.0',
    'vscode-editorid': 'vscode-chat',
    'vscode-machineid': 'default'
}

const copilotTokenCache = new Map<string, { token: string; expiresAt: number }>()
const copilotModelCache = new Map<string, { models: INodeOptionsValue[]; expiresAt: number }>()

const normalizeExpiresAt = (expiresAt: number) => {
    if (expiresAt > 1_000_000_000_000) {
        return Math.floor(expiresAt / 1000)
    }
    return expiresAt
}

const normalizeBaseUrl = (baseUrl?: string) => {
    const trimmed = baseUrl?.trim()
    if (!trimmed) {
        return DEFAULT_BASE_URL
    }
    return trimmed.replace(/\/+$/, '')
}

const parseAdditionalHeaders = (baseOptions: unknown): Record<string, string> | undefined => {
    if (!baseOptions) return undefined
    try {
        return typeof baseOptions === 'object' ? (baseOptions as Record<string, string>) : JSON.parse(baseOptions as string)
    } catch (exception) {
        throw new Error("Invalid JSON in the GitHub Copilot's Additional Headers: " + exception)
    }
}

const getCachedCopilotModels = (cacheKey: string) => {
    const cached = copilotModelCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
        return cached.models
    }
    if (cached) {
        copilotModelCache.delete(cacheKey)
    }
    return undefined
}

const cacheCopilotModels = (cacheKey: string, models: INodeOptionsValue[]) => {
    if (!models.length) return
    copilotModelCache.set(cacheKey, { models, expiresAt: Date.now() + COPILOT_MODEL_CACHE_TTL_MS })
}

const buildModelCacheKey = (tokenCacheKey: string, baseUrl: string, additionalHeaders?: Record<string, string>) => {
    if (!additionalHeaders) {
        return `copilot-models:${tokenCacheKey}:${baseUrl}`
    }
    const headerKey = Object.keys(additionalHeaders)
        .sort()
        .map((key) => `${key}:${additionalHeaders[key]}`)
        .join('|')
    return `copilot-models:${tokenCacheKey}:${baseUrl}:${headerKey}`
}

const normalizeCopilotModels = (payload: unknown): INodeOptionsValue[] => {
    const options: INodeOptionsValue[] = []
    const seen = new Set<string>()

    const addModel = (name?: string, label?: string) => {
        if (!name) return
        const trimmed = name.trim()
        if (!trimmed || seen.has(trimmed)) return
        seen.add(trimmed)
        options.push({
            label: label?.trim() || trimmed,
            name: trimmed
        })
    }

    const readItem = (item: any) => {
        if (!item) return
        if (typeof item === 'string') {
            addModel(item)
            return
        }
        if (typeof item === 'object') {
            addModel(item.id ?? item.name ?? item.model ?? item.slug, item.label ?? item.display_name ?? item.displayName)
        }
    }

    if (Array.isArray(payload)) {
        payload.forEach(readItem)
        return options
    }

    const data = (payload as any)?.data
    const models = (payload as any)?.models
    const items = (payload as any)?.items

    if (Array.isArray(data)) {
        data.forEach(readItem)
    } else if (Array.isArray(models)) {
        models.forEach(readItem)
    } else if (Array.isArray(items)) {
        items.forEach(readItem)
    }

    return options
}

const fetchCopilotModels = async (
    copilotToken: string,
    baseUrl: string,
    additionalHeaders?: Record<string, string>
): Promise<INodeOptionsValue[]> => {
    const fetch = (await import('node-fetch')).default
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}${COPILOT_MODEL_LIST_PATH}`, {
        headers: {
            Authorization: `Bearer ${copilotToken}`,
            Accept: 'application/json',
            ...COPILOT_HEADERS,
            ...(additionalHeaders ?? {})
        }
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get Copilot models: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    return normalizeCopilotModels(data)
}

const getCachedCopilotToken = (cacheKey: string, credentialData: ICommonObject) => {
    const cached = copilotTokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now() / 1000 + TOKEN_REFRESH_BUFFER_SECONDS) {
        return cached.token
    }

    const storedToken = credentialData.copilotToken as string | undefined
    const storedExpiresAt = credentialData.copilotTokenExpiresAt as number | undefined
    if (storedToken && storedExpiresAt) {
        const normalizedExpiresAt = normalizeExpiresAt(storedExpiresAt)
        if (normalizedExpiresAt > Date.now() / 1000 + TOKEN_REFRESH_BUFFER_SECONDS) {
            copilotTokenCache.set(cacheKey, { token: storedToken, expiresAt: normalizedExpiresAt })
            return storedToken
        }
    }

    return undefined
}

const fetchCopilotToken = async (githubAccessToken: string): Promise<{ token: string; expiresAt: number }> => {
    const fetch = (await import('node-fetch')).default
    const response = await fetch(COPILOT_TOKEN_URL, {
        headers: {
            Authorization: `token ${githubAccessToken}`,
            ...COPILOT_HEADERS
        }
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get Copilot token: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = (await response.json()) as { token: string; expires_at: number }
    return {
        token: data.token,
        expiresAt: normalizeExpiresAt(data.expires_at)
    }
}

const getCopilotToken = async (cacheKey: string, githubAccessToken: string, credentialData: ICommonObject) => {
    const cached = getCachedCopilotToken(cacheKey, credentialData)
    if (cached) return cached

    const { token, expiresAt } = await fetchCopilotToken(githubAccessToken)
    copilotTokenCache.set(cacheKey, { token, expiresAt })
    return token
}

class ChatGitHubCopilot_ChatModels implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'GitHub Copilot'
        this.name = 'chatGitHubCopilot'
        this.version = 1.0
        this.type = 'ChatGitHubCopilot'
        this.icon = 'github.svg'
        this.category = 'Chat Models'
        this.description = 'GitHub Copilot chat completions via the Copilot API'
        this.baseClasses = [this.type, ...getBaseClasses(LangchainChatOpenAI)]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['githubCopilotApi']
        }
        this.inputs = [
            {
                label: 'Cache',
                name: 'cache',
                type: 'BaseCache',
                optional: true
            },
            {
                label: 'Model Name',
                name: 'modelName',
                type: 'asyncOptions',
                loadMethod: 'listModels',
                default: 'gpt-4o'
            },
            {
                label: 'Temperature',
                name: 'temperature',
                type: 'number',
                step: 0.1,
                default: 0.9,
                optional: true
            },
            {
                label: 'Streaming',
                name: 'streaming',
                type: 'boolean',
                default: true,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Max Tokens',
                name: 'maxTokens',
                type: 'number',
                step: 1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Top Probability',
                name: 'topP',
                type: 'number',
                step: 0.1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Frequency Penalty',
                name: 'frequencyPenalty',
                type: 'number',
                step: 0.1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Presence Penalty',
                name: 'presencePenalty',
                type: 'number',
                step: 0.1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Timeout',
                name: 'timeout',
                type: 'number',
                step: 1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Stop Sequence',
                name: 'stopSequence',
                type: 'string',
                rows: 4,
                optional: true,
                description: 'List of stop words to use when generating. Use comma to separate multiple stop words.',
                additionalParams: true
            },
            {
                label: 'BasePath',
                name: 'basepath',
                type: 'string',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Additional Headers',
                name: 'baseOptions',
                type: 'json',
                optional: true,
                additionalParams: true
            }
        ]
    }

    //@ts-ignore
    loadMethods = {
        async listModels(nodeData: INodeData, options: ICommonObject): Promise<INodeOptionsValue[]> {
            const fallbackModels = await getModels(MODEL_TYPE.CHAT, 'chatGitHubCopilot')
            const resolvedNodeData = {
                ...nodeData,
                inputs: nodeData.inputs ?? {}
            }
            const credentialId =
                (resolvedNodeData.inputs as ICommonObject)?.credentialId || (resolvedNodeData.credential as string | undefined)

            if (!credentialId) {
                return fallbackModels
            }

            const credentialData = await getCredentialData(credentialId, options)
            const githubAccessToken = getCredentialParam('githubAccessToken', credentialData, resolvedNodeData as INodeData)

            if (!githubAccessToken) {
                return fallbackModels
            }

            const baseUrl = normalizeBaseUrl(resolvedNodeData.inputs?.basepath as string | undefined)
            const additionalHeaders = parseAdditionalHeaders(resolvedNodeData.inputs?.baseOptions)
            const tokenCacheKey = credentialId || githubAccessToken
            const cacheKey = buildModelCacheKey(tokenCacheKey, baseUrl, additionalHeaders)
            const cachedModels = getCachedCopilotModels(cacheKey)

            if (cachedModels) {
                return cachedModels
            }

            try {
                const copilotToken = await getCopilotToken(tokenCacheKey, githubAccessToken, credentialData)
                const models = await fetchCopilotModels(copilotToken, baseUrl, additionalHeaders)
                if (models.length) {
                    cacheCopilotModels(cacheKey, models)
                    return models
                }
            } catch (error) {
                return fallbackModels
            }

            return fallbackModels
        }
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const temperature = nodeData.inputs?.temperature as string
        const modelName = nodeData.inputs?.modelName as string
        const maxTokens = nodeData.inputs?.maxTokens as string
        const topP = nodeData.inputs?.topP as string
        const frequencyPenalty = nodeData.inputs?.frequencyPenalty as string
        const presencePenalty = nodeData.inputs?.presencePenalty as string
        const timeout = nodeData.inputs?.timeout as string
        const stopSequence = nodeData.inputs?.stopSequence as string
        const streaming = nodeData.inputs?.streaming as boolean
        const basePath = nodeData.inputs?.basepath as string
        const baseOptions = nodeData.inputs?.baseOptions
        const cache = nodeData.inputs?.cache as BaseCache

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const githubAccessToken = getCredentialParam('githubAccessToken', credentialData, nodeData)

        if (!githubAccessToken) {
            throw new Error('GitHub access token not found. Please authenticate the GitHub Copilot credential.')
        }

        const cacheKey = nodeData.credential || githubAccessToken
        const copilotToken = await getCopilotToken(cacheKey, githubAccessToken, credentialData)

        const obj: ChatOpenAIFields = {
            temperature: parseFloat(temperature),
            modelName,
            openAIApiKey: copilotToken,
            apiKey: copilotToken,
            streaming: streaming ?? true
        }

        if (maxTokens) obj.maxTokens = parseInt(maxTokens, 10)
        if (topP) obj.topP = parseFloat(topP)
        if (frequencyPenalty) obj.frequencyPenalty = parseFloat(frequencyPenalty)
        if (presencePenalty) obj.presencePenalty = parseFloat(presencePenalty)
        if (timeout) obj.timeout = parseInt(timeout, 10)
        if (cache) obj.cache = cache
        if (stopSequence) {
            const stopSequenceArray = stopSequence.split(',').map((item) => item.trim())
            obj.stop = stopSequenceArray
        }

        const parsedBaseOptions = parseAdditionalHeaders(baseOptions)

        obj.configuration = {
            baseURL: basePath || DEFAULT_BASE_URL,
            defaultHeaders: {
                ...COPILOT_HEADERS,
                ...(parsedBaseOptions ?? {})
            }
        }

        const model = new LangchainChatOpenAI(obj)
        return model
    }
}

module.exports = { nodeClass: ChatGitHubCopilot_ChatModels }
