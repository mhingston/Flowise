import { INodeParams, INodeCredential } from '../src/Interface'

class GithubCopilotApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'GitHub Copilot API'
        this.name = 'githubCopilotApi'
        this.version = 1.0
        this.description =
            'Use GitHub Device Flow to populate the token, or paste a GitHub access token with Copilot access.'
        this.inputs = [
            {
                label: 'GitHub Access Token',
                name: 'githubAccessToken',
                type: 'password',
                optional: true,
                placeholder: '<GITHUB_ACCESS_TOKEN>'
            }
        ]
    }
}

module.exports = { credClass: GithubCopilotApi }
