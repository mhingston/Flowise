# GitHub Copilot Chat Model

GitHub Copilot chat completion integration for Flowise.

## Credentials

Use the "GitHub Copilot API" credential. You can either:

- Use the "Authenticate with GitHub Device Flow" button in the credential dialog.
- Paste a GitHub access token that can access Copilot.

The chat model exchanges the GitHub access token for a Copilot token on demand.

## Configuration

- BasePath: Override the Copilot API base URL (default: https://api.githubcopilot.com).
- Additional Headers: Optional JSON map of extra headers sent to the Copilot API.

## Environment Variables

| Variable                    | Description                                  | Type   | Default |
| --------------------------- | -------------------------------------------- | ------ | ------- |
| GITHUB_DEVICE_FLOW_CLIENT_ID | GitHub OAuth app client ID for device flow   | String | Iv1.b507a08c87ecfe98 |
| GITHUB_DEVICE_FLOW_SCOPE    | OAuth scopes requested during device flow    | String | read:user workflow repo |

## License

Source code in this repository is made available under the [Apache License Version 2.0](https://github.com/FlowiseAI/Flowise/blob/master/LICENSE.md).
