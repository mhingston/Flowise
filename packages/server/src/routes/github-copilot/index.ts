import express from 'express'
import axios from 'axios'
import { Request, Response, NextFunction } from 'express'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { Credential } from '../../database/entities/Credential'
import { decryptCredentialData, encryptCredentialData } from '../../utils'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { StatusCodes } from 'http-status-codes'

const router = express.Router()

const DEFAULT_GITHUB_DEVICE_FLOW_CLIENT_ID = 'Iv1.b507a08c87ecfe98' // opencode-copilot-auth client ID
const DEFAULT_GITHUB_DEVICE_FLOW_SCOPE = 'read:user workflow repo'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

const resolveDeviceFlowConfig = (credentialData: Record<string, unknown>) => {
    const clientId =
        (credentialData.deviceFlowClientId as string | undefined) ||
        (credentialData.clientId as string | undefined) ||
        process.env.GITHUB_DEVICE_FLOW_CLIENT_ID ||
        DEFAULT_GITHUB_DEVICE_FLOW_CLIENT_ID
    const scope =
        (credentialData.deviceFlowScope as string | undefined) ||
        (credentialData.scope as string | undefined) ||
        process.env.GITHUB_DEVICE_FLOW_SCOPE ||
        DEFAULT_GITHUB_DEVICE_FLOW_SCOPE

    return { clientId, scope }
}

router.post('/device/:credentialId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { credentialId } = req.params
        const appServer = getRunningExpressApp()
        const credentialRepository = appServer.AppDataSource.getRepository(Credential)

        const credential = await credentialRepository.findOneBy({ id: credentialId })
        if (!credential) {
            return res.status(404).json({ success: false, message: 'Credential not found' })
        }

        const decryptedData = await decryptCredentialData(credential.encryptedData)
        const { clientId, scope } = resolveDeviceFlowConfig(decryptedData)

        if (!clientId) {
            return res.status(400).json({ success: false, message: 'Missing GitHub device flow client ID' })
        }

        const response = await axios.post(
            DEVICE_CODE_URL,
            { client_id: clientId, scope },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                }
            }
        )

        return res.json({
            success: true,
            credentialId,
            ...response.data
        })
    } catch (error) {
        next(
            new InternalFlowiseError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                `GitHub device flow init error: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
        )
    }
})

router.post('/device/poll/:credentialId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { credentialId } = req.params
        const deviceCode = (req.body?.deviceCode as string | undefined) || (req.body?.device_code as string | undefined)

        if (!deviceCode) {
            return res.status(400).json({ success: false, message: 'Missing deviceCode in request body' })
        }

        const appServer = getRunningExpressApp()
        const credentialRepository = appServer.AppDataSource.getRepository(Credential)

        const credential = await credentialRepository.findOneBy({ id: credentialId })
        if (!credential) {
            return res.status(404).json({ success: false, message: 'Credential not found' })
        }

        const decryptedData = await decryptCredentialData(credential.encryptedData)
        const { clientId } = resolveDeviceFlowConfig(decryptedData)

        if (!clientId) {
            return res.status(400).json({ success: false, message: 'Missing GitHub device flow client ID' })
        }

        const tokenResponse = await axios.post(
            ACCESS_TOKEN_URL,
            {
                client_id: clientId,
                device_code: deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                }
            }
        )

        const tokenData = tokenResponse.data as {
            access_token?: string
            token_type?: string
            scope?: string
            error?: string
            error_description?: string
        }

        if (tokenData.access_token) {
            const updatedCredentialData = {
                ...decryptedData,
                githubAccessToken: tokenData.access_token,
                githubTokenType: tokenData.token_type,
                githubTokenScope: tokenData.scope,
                githubTokenReceivedAt: new Date().toISOString()
            }
            const encryptedData = await encryptCredentialData(updatedCredentialData)
            await credentialRepository.update(credential.id, { encryptedData, updatedDate: new Date() })

            return res.json({
                success: true,
                status: 'authorized',
                credentialId
            })
        }

        if (tokenData.error === 'authorization_pending' || tokenData.error === 'slow_down') {
            return res.json({
                success: false,
                status: tokenData.error,
                error_description: tokenData.error_description
            })
        }

        return res.status(400).json({
            success: false,
            status: tokenData.error || 'unknown_error',
            message: tokenData.error_description || 'Device flow failed'
        })
    } catch (error) {
        next(
            new InternalFlowiseError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                `GitHub device flow polling error: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
        )
    }
})

export default router
