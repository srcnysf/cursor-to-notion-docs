# Cursor to Notion Documentation Extension

A VS Code extension that seamlessly integrates Cursor IDE with Notion for real-time documentation management. Create, update, and sync your project documentation directly from your IDE to Notion.

## Setup Instructions

### 1. Create a Notion Integration

1. Go to [Notion Integrations page](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name your integration (e.g., "Cursor Docs")
4. Select the workspace where you want to use the integration
5. Click "Submit" to create the integration
6. Copy your "Internal Integration Token"

### 2. Configure Extension

1. Open Command Palette in VS Code (Cmd/Ctrl + Shift + P)
2. Search for "Notion: Configure Settings"
3. Paste your Integration Token when prompted
4. The extension will verify your connection

### 3. Share Notion Pages

For each page you want to use with the extension:

1. Open the Notion page
2. Click "Share" in the top right
3. Under "Add connections", find your integration name
4. Click "Invite"
5. The page is now connected to the extension

## Usage

### Creating New Documentation

1. Open Command Palette
2. Select "Notion: Create New Documentation"
3. Enter a title for your documentation
4. Share the target Notion page with your integration
5. Paste the Notion page URL when prompted
6. Edit the `.notion-docs` file that opens
7. On your `.cursorrules` file, add the Documentation part to use `.notion-docs` file for documentation and to update it automatically after necessary changes (you can also tell the agent to update the documentation after certain changes)
8. Changes will automatically sync to Notion

### Updating Documentation

The extension automatically watches the `.notion-docs` file and syncs changes to Notion in real-time.

## Features

- Real-time sync between Cursor and Notion
- Markdown support
- Automatic file watching
- Project-specific configuration
- Global API key management
- Support for:
  - Headers (H1, H2, H3)
  - Lists (bullet and numbered)
  - Code blocks with language support
  - Bold text
  - Paragraphs

## Important Notes

- Each project can have its own Notion target page
- The API key is stored globally and reused across projects
- You must share each Notion page with the integration
- Changes sync automatically when you save the `.notion-docs` file

## Troubleshooting

### Common Issues

1. **"Failed to connect to Notion API"**

   - Verify your API key is correct
   - Check your internet connection

2. **"Cannot access page"**

   - Make sure you've shared the page with your integration
   - Check if the page URL is correct

3. **"Failed to update documentation"**
   - Verify the page is still shared with the integration
   - Check if you have edit permissions

## License

MIT License - See LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## Support

If you encounter any issues or have questions:

1. Check the troubleshooting section
2. Submit an issue on GitHub
3. Contact the maintainers
