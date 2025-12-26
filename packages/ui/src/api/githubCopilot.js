import client from './client'

const startDeviceFlow = (credentialId) => client.post(`/github-copilot/device/${credentialId}`)

const pollDeviceFlow = (credentialId, deviceCode) =>
    client.post(`/github-copilot/device/poll/${credentialId}`, {
        deviceCode
    })

export default {
    startDeviceFlow,
    pollDeviceFlow
}
