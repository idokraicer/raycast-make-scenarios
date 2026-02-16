# Search Make Scenarios

Search, browse, and open [Make.com](https://www.make.com) scenarios across all your organizations, teams, and zones — directly from Raycast.

## Features

- **Unified search** — Search scenarios and organizations in one place with a type filter
- **Scenario search** — Browse all scenarios with filtering by organization or team
- **Organization search** — Quickly jump to any organization's scenarios page
- **Multi-zone support** — Works across EU1, EU2, US1, US2, and Celonis zones
- **Smart sorting** — Your own recently edited scenarios appear first
- **Quick actions** — Open in Make.com, copy scenario URLs, and copy webhook URLs
- **Concurrent loading** — Fetches data from all organizations in parallel for fast results
- **Graceful degradation** — Organizations without API access (free plans) are shown separately

## Commands

| Command | Description |
| --- | --- |
| **Search Make** | Unified search across scenarios and organizations with a type dropdown filter |
| **Search Make Scenarios** | Browse all scenarios with filtering by organization or team |
| **Search Make Organizations** | Search organizations and jump to their scenarios page |

## Setup

1. Install the extension
2. Get your Make.com API token from your [profile settings](https://www.make.com/en/profile/api)
3. On first launch, enter your **API Token** and select your **Zone** (found in your Make.com account URL, e.g. `eu1.make.com`)

> The extension accepts both the bare token value and the `Token xxx` format.

## Supported Zones

- EU1 (`eu1.make.com`)
- EU2 (`eu2.make.com`)
- US1 (`us1.make.com`)
- US2 (`us2.make.com`)
- Celonis EU (`eu1.make.celonis.com`)
- Celonis US (`us1.make.celonis.com`)

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Enter` | Open scenario / organization in Make.com |
| `Cmd + C` | Copy URL to clipboard |
| `Cmd + Shift + C` | Copy webhook URL (scenarios with webhooks) |
| `Cmd + R` | Refresh data |
