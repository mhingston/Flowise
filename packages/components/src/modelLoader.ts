import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { INodeOptionsValue } from './Interface'

export enum MODEL_TYPE {
    CHAT = 'chat',
    LLM = 'llm',
    EMBEDDING = 'embedding'
}

const getModelsJSONPath = (): string => {
    const checkModelsPaths = [path.join(__dirname, '..', 'models.json'), path.join(__dirname, '..', '..', 'models.json')]
    for (const checkPath of checkModelsPaths) {
        if (fs.existsSync(checkPath)) {
            return checkPath
        }
    }
    return ''
}

const getCategoryModels = (models: any, category: MODEL_TYPE) => {
    const categoryModels = models?.[category]
    return Array.isArray(categoryModels) ? categoryModels : []
}

const isValidUrl = (urlString: string) => {
    let url
    try {
        url = new URL(urlString)
    } catch (e) {
        return false
    }
    return url.protocol === 'http:' || url.protocol === 'https:'
}

/**
 * Load the raw model file from either a URL or a local file
 * If any of the loading fails, fallback to the default models.json file on disk
 */
const getRawModelFile = async () => {
    const modelFile =
        process.env.MODEL_LIST_CONFIG_JSON ?? 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/components/models.json'
    try {
        if (isValidUrl(modelFile)) {
            const resp = await axios.get(modelFile)
            if (resp.status === 200 && resp.data) {
                return resp.data
            } else {
                throw new Error('Error fetching model list')
            }
        } else if (fs.existsSync(modelFile)) {
            const models = await fs.promises.readFile(modelFile, 'utf8')
            if (models) {
                return JSON.parse(models)
            }
        }
        throw new Error('Model file does not exist or is empty')
    } catch (e) {
        const models = await fs.promises.readFile(getModelsJSONPath(), 'utf8')
        if (models) {
            return JSON.parse(models)
        }
        return {}
    }
}

const getDefaultModelFile = async () => {
    try {
        const models = await fs.promises.readFile(getModelsJSONPath(), 'utf8')
        if (models) {
            return JSON.parse(models)
        }
    } catch (e) {
        return {}
    }
    return {}
}

const getModelConfig = async (category: MODEL_TYPE, name: string) => {
    const models = await getRawModelFile()

    const categoryModels = getCategoryModels(models, category)
    let modelConfig = categoryModels.find((model: INodeOptionsValue) => model.name === name)

    if (!modelConfig) {
        const fallbackModels = await getDefaultModelFile()
        const fallbackCategoryModels = getCategoryModels(fallbackModels, category)
        modelConfig = fallbackCategoryModels.find((model: INodeOptionsValue) => model.name === name)
    }

    return modelConfig
}

export const getModelConfigByModelName = async (category: MODEL_TYPE, provider: string | undefined, name: string | undefined) => {
    const models = await getRawModelFile()

    const categoryModels = getCategoryModels(models, category)
    let modelConfig = getSpecificModelFromCategory(categoryModels, provider, name)

    if (!modelConfig) {
        const fallbackModels = await getDefaultModelFile()
        const fallbackCategoryModels = getCategoryModels(fallbackModels, category)
        modelConfig = getSpecificModelFromCategory(fallbackCategoryModels, provider, name)
    }

    return modelConfig
}

const getSpecificModelFromCategory = (categoryModels: any, provider: string | undefined, name: string | undefined) => {
    if (!Array.isArray(categoryModels)) return undefined

    for (const cm of categoryModels) {
        if (cm.models && cm.name.toLowerCase() === provider?.toLowerCase()) {
            for (const m of cm.models) {
                if (m.name === name) {
                    return m
                }
            }
        }
    }
    return undefined
}

export const getModels = async (category: MODEL_TYPE, name: string) => {
    const returnData: INodeOptionsValue[] = []
    try {
        const modelConfig = await getModelConfig(category, name)
        if (!modelConfig || !Array.isArray(modelConfig.models)) {
            return returnData
        }
        returnData.push(...modelConfig.models)
        return returnData
    } catch (e) {
        throw new Error(`Error: getModels - ${e}`)
    }
}

export const getRegions = async (category: MODEL_TYPE, name: string) => {
    const returnData: INodeOptionsValue[] = []
    try {
        const modelConfig = await getModelConfig(category, name)
        if (!modelConfig || !Array.isArray(modelConfig.regions)) {
            return returnData
        }
        returnData.push(...modelConfig.regions)
        return returnData
    } catch (e) {
        throw new Error(`Error: getRegions - ${e}`)
    }
}
