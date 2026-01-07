# Page Summariser Extension

A Chrome/Opera browser extension that extracts webpage content, summarizes it using OpenRouter API, and allows you to export the summary to a text file.

## Features

- **Smart Content Extraction**: Intelligently extracts main content from webpages while preserving list structure
- **AI-Powered Summarization**: Uses OpenRouter API to summarize content, perfect for "top 10" lists and articles
- **Clean UI**: Modern, responsive popup interface with loading states and error handling
- **Export Functionality**: Save summaries as text files with the webpage title as filename
- **Secure**: API keys stored locally in browser storage

## Installation

1. **Generate Icons** (Required):
   - Open `icons/generate-icons.html` in your browser
   - Click "Download" for each icon size (16x16, 48x48, 128x128)
   - Save them in the `icons/` folder with exact names: `icon16.png`, `icon48.png`, `icon128.png`

2. **Load Extension**:
   - Open Chrome/Opera and navigate to `chrome://extensions/` (or `opera://extensions/`)
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `Page_Summariser_Extension` folder

## Usage

1. **Get OpenRouter API Key**:
   - Sign up at [OpenRouter.ai](https://openrouter.ai)
   - Get your API key from the dashboard
   - Optionally, note your preferred model code (e.g., `openai/gpt-3.5-turbo`)

2. **Summarize a Page**:
   - Navigate to any webpage you want to summarize
   - Click the extension icon in your browser toolbar
   - Enter your OpenRouter API key
   - (Optional) Enter your custom model code
   - Click "Summarize Page"
   - Wait for the summary to appear

3. **Export Summary**:
   - After summarization, click "Export to File"
   - Choose your save location
   - The file will be saved with the webpage title as the filename

## File Structure

```
Page_Summariser_Extension/
├── manifest.json              # Extension configuration
├── popup/
│   ├── popup.html            # Popup UI
│   ├── popup.css             # Styling
│   └── popup.js              # Popup logic
├── content/
│   └── content.js            # Content extraction script
├── background/
│   └── service-worker.js     # API calls handler
├── icons/
│   ├── generate-icons.html   # Icon generator tool
│   ├── icon16.png           # 16x16 icon (generate first)
│   ├── icon48.png           # 48x48 icon (generate first)
│   └── icon128.png          # 128x128 icon (generate first)
└── README.md                 # This file
```

## Requirements

- Chrome/Opera browser (Chromium-based)
- OpenRouter API key
- Internet connection for API calls

## Permissions

The extension requires the following permissions:
- `activeTab`: To access the current webpage content
- `storage`: To save your API key locally
- `scripting`: To inject content scripts
- `downloads`: To save exported files
- `https://openrouter.ai/*`: To make API calls

## Troubleshooting

### "Could not access current tab"
- Refresh the webpage and try again
- Make sure you're not on a browser system page (chrome://, opera://)

### "Failed to extract page content"
- The page may be protected or not fully loaded
- Try refreshing the page and waiting a moment before summarizing

### "API error: 401"
- Your API key is invalid or expired
- Check your OpenRouter account and regenerate the key

### "Rate limit exceeded"
- You've made too many requests
- Wait a few moments and try again

### Icons not showing
- Make sure you've generated and saved all three icon files (icon16.png, icon48.png, icon128.png) in the `icons/` folder

## Privacy & Security

- Your API key is stored locally in your browser's storage
- No data is sent to any server except OpenRouter API
- Page content is only sent to OpenRouter for summarization
- The extension does not collect or store any personal information

## Development

To modify the extension:
1. Make your changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## License

This project is open source and available for personal use.

## Support

For issues or questions:
- Check the troubleshooting section above
- Review OpenRouter API documentation
- Ensure all files are in the correct locations

