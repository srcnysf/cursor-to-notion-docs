const { Client } = require("@notionhq/client");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs").promises;
const vscode = require("vscode");

let notion;
let currentDocWatcher = null;
let currentTitle = null;
let debounceTimer = null;

// Configuration management
async function getConfiguration() {
  try {
    const configPath = path.join(
      process.env.HOME,
      ".cursor",
      "notion-config.json"
    );
    const config = await fs.readFile(configPath, "utf8");
    return JSON.parse(config);
  } catch (error) {
    return null;
  }
}

async function saveConfiguration(config) {
  const configPath = path.join(
    process.env.HOME,
    ".cursor",
    "notion-config.json"
  );
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

// Setup wizard
async function setupWizard(window) {
  try {
    const config = {};

    const apiKey = await window.showInputBox({
      prompt:
        "Enter your Notion API Key (from https://www.notion.so/my-integrations)",
      placeHolder: "secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    if (!apiKey) {
      throw new Error("Notion API Key is required");
    }

    config.NOTION_API_KEY = apiKey;

    const pageId = await window.showInputBox({
      prompt: "Enter your Notion Page ID (the ID from your Notion page URL)",
      placeHolder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    if (!pageId) {
      throw new Error("Notion Page ID is required");
    }

    config.NOTION_PAGE_ID = pageId;

    await saveConfiguration(config);
    return config;
  } catch (error) {
    throw error;
  }
}

// Initialize Notion client
async function initializeNotion(window) {
  try {
    let config = await getConfiguration();

    if (!config || !config.NOTION_API_KEY || !config.NOTION_PAGE_ID) {
      config = await setupWizard(window);
    }

    notion = new Client({
      auth: config.NOTION_API_KEY,
    });

    const isConnected = await verifyNotionConnection();
    if (isConnected) {
      window.showInformationMessage("Successfully connected to Notion!");
      return true;
    } else {
      throw new Error("Failed to connect to Notion API");
    }
  } catch (error) {
    if (window) {
      window.showErrorMessage(`Notion setup required: ${error.message}`);
    }
    return false;
  }
}

// Verify Notion connection
async function verifyNotionConnection() {
  try {
    const response = await notion.users.me();
    return true;
  } catch (error) {
    return false;
  }
}

// Yardımcı fonksiyon - içeriği 2000 karakterlik bloklara böler
function splitContentIntoBlocks(content) {
  const MAX_BLOCK_SIZE = 2000;
  const blocks = [];
  let remainingContent = content;

  while (remainingContent.length > 0) {
    // En yakın paragraf sonunu bul
    let endIndex = MAX_BLOCK_SIZE;
    if (remainingContent.length > MAX_BLOCK_SIZE) {
      const lastNewline = remainingContent.lastIndexOf("\n", MAX_BLOCK_SIZE);
      endIndex = lastNewline > 0 ? lastNewline : MAX_BLOCK_SIZE;
    } else {
      endIndex = remainingContent.length;
    }

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: remainingContent.slice(0, endIndex),
            },
          },
        ],
      },
    });

    remainingContent = remainingContent.slice(endIndex).trim();
  }

  return blocks;
}

function convertMarkdownToNotionBlocks(content) {
  const lines = content.split("\n");
  const blocks = [];
  let codeBlock = null;
  let currentSection = {
    type: "paragraph",
    paragraph: {
      rich_text: [],
    },
  };

  function addSection() {
    if (currentSection.paragraph.rich_text.length > 0) {
      blocks.push(currentSection);
      currentSection = {
        type: "paragraph",
        paragraph: {
          rich_text: [],
        },
      };
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers are always separate blocks
    if (line.startsWith("# ")) {
      addSection();
      blocks.push({
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
      continue;
    } else if (line.startsWith("## ")) {
      addSection();
      blocks.push({
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      });
      continue;
    } else if (line.startsWith("### ")) {
      addSection();
      blocks.push({
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      });
      continue;
    }

    // Code blocks
    if (line.startsWith("```")) {
      if (codeBlock) {
        blocks.push(codeBlock);
        codeBlock = null;
      } else {
        addSection();
        const language = line.slice(3).trim();
        codeBlock = {
          type: "code",
          code: {
            language: language || "plain text",
            rich_text: [{ type: "text", text: { content: "" } }],
          },
        };
      }
      continue;
    }

    if (codeBlock) {
      codeBlock.code.rich_text[0].text.content += line + "\n";
      continue;
    }

    // Lists and other content get combined into paragraphs
    if (line.match(/^[*-] /)) {
      currentSection.paragraph.rich_text.push({
        type: "text",
        text: { content: "• " + line.slice(2) + "\n" },
      });
    } else if (line.match(/^\d+\. /)) {
      currentSection.paragraph.rich_text.push({
        type: "text",
        text: { content: line + "\n" },
      });
    } else if (line.includes("**")) {
      const parts = line.split("**");
      parts.forEach((part, index) => {
        if (index % 2 === 0) {
          if (part) {
            currentSection.paragraph.rich_text.push({
              type: "text",
              text: { content: part },
            });
          }
        } else {
          currentSection.paragraph.rich_text.push({
            type: "text",
            text: { content: part },
            annotations: { bold: true },
          });
        }
      });
      currentSection.paragraph.rich_text.push({
        type: "text",
        text: { content: "\n" },
      });
    } else {
      currentSection.paragraph.rich_text.push({
        type: "text",
        text: { content: line + "\n" },
      });
    }

    // If current section is getting too large, start a new one
    if (JSON.stringify(currentSection).length > 1500) {
      addSection();
    }
  }

  // Add any remaining content
  addSection();

  // Ensure we don't exceed 100 blocks
  if (blocks.length > 100) {
    // Combine excess blocks into the last block
    const excessBlocks = blocks.splice(99);
    const lastBlock = blocks[98];
    if (lastBlock.paragraph) {
      lastBlock.paragraph.rich_text.push({
        type: "text",
        text: {
          content:
            "\n\n[Additional content truncated due to Notion's block limit]",
        },
      });
    }
  }

  return blocks;
}

// Create documentation
async function createNotionDoc(title, content, pageId) {
  const blocks = convertMarkdownToNotionBlocks(content);

  const response = await notion.pages.create({
    parent: { page_id: pageId },
    properties: {
      title: {
        title: [{ text: { content: title } }],
      },
    },
    children: blocks,
  });
  return response;
}

// Update documentation
async function updateNotionDoc(pageId, content) {
  try {
    // Mevcut blokları al
    const { results } = await notion.blocks.children.list({ block_id: pageId });

    // Önce tüm blokları arşivden çıkar
    for (const block of results) {
      try {
        await notion.blocks.update({
          block_id: block.id,
          archived: false,
        });
        // Blokları sil
        await notion.blocks.delete({ block_id: block.id });
      } catch (error) {
        console.error(`Failed to process block ${block.id}:`, error);
      }
    }

    // Yeni blokları ekle
    const blocks = convertMarkdownToNotionBlocks(content);
    const response = await notion.blocks.children.append({
      block_id: pageId,
      children: blocks,
    });
    return response;
  } catch (error) {
    throw new Error(`Failed to update Notion doc: ${error.message}`);
  }
}

// Yeni helper fonksiyon ekliyoruz
async function createNotionDocsFile(content) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error("No workspace folder open");
  }

  const notionDocsPath = path.join(
    workspaceFolders[0].uri.fsPath,
    ".notion-docs"
  );
  await fs.writeFile(notionDocsPath, content);

  // Dosyayı VS Code'da aç
  const document = await vscode.workspace.openTextDocument(notionDocsPath);
  await vscode.window.showTextDocument(document);

  return content;
}

async function setupFileWatcher(title) {
  // Clear any existing watcher
  if (currentDocWatcher) {
    currentDocWatcher.dispose();
  }

  currentTitle = title;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error("No workspace folder open");
  }

  const notionDocsPath = path.join(
    workspaceFolders[0].uri.fsPath,
    ".notion-docs"
  );
  const pattern = new vscode.RelativePattern(
    workspaceFolders[0],
    ".notion-docs"
  );

  // Create new file watcher
  currentDocWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  // On file change
  currentDocWatcher.onDidChange(async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      try {
        const config = await getConfiguration();
        if (!config) {
          throw new Error("Notion configuration not found");
        }

        const content = await fs.readFile(notionDocsPath, "utf8");

        await updateNotionDoc(config.NOTION_PAGE_ID, content);
        vscode.window.showInformationMessage(
          "Documentation auto-updated in Notion!"
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          "Failed to auto-update documentation: " + error.message
        );
      }
    }, 2000);
  });

  return currentDocWatcher;
}

async function activate(context) {
  let initialized = false;

  // Başlangıçta Notion'ı başlat ve dosya izleyiciyi kur
  async function initializeExtension() {
    try {
      const success = await initializeNotion(vscode.window);
      if (success) {
        initialized = true;

        // Workspace'de .notion-docs dosyasını ara
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          const notionDocsPath = path.join(
            workspaceFolders[0].uri.fsPath,
            ".notion-docs"
          );

          // Dosya varsa izleyiciyi başlat
          try {
            await fs.access(notionDocsPath);
            await setupFileWatcher("Documentation"); // Default title
            vscode.window.showInformationMessage(
              "Notion documentation watcher started!"
            );
          } catch (err) {
            // .notion-docs dosyası henüz oluşturulmamış, bu normal
          }
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to initialize Notion extension: ${error.message}`
      );
    }
  }

  // Extension başladığında otomatik olarak başlat
  initializeExtension();

  // Command registrations ekliyoruz
  const configureCommand = vscode.commands.registerCommand(
    "cursor_to_notion_docs.configure",
    // Mevcut configure fonksiyonunu kullanıyoruz
    async () => {
      try {
        const config = await setupWizard(vscode.window);
        notion = new Client({
          auth: config.NOTION_API_KEY,
        });
        const isConnected = await verifyNotionConnection();
        if (isConnected) {
          initialized = true;
          vscode.window.showInformationMessage(
            "Notion configuration updated successfully!"
          );
        } else {
          throw new Error("Failed to connect to Notion API");
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Configuration failed: ${error.message}`
        );
      }
    }
  );

  const createDocCommand = vscode.commands.registerCommand(
    "cursor_to_notion_docs.createDoc",
    async () => {
      try {
        if (!initialized) {
          const success = await initializeNotion(vscode.window);
          if (!success) return;
          initialized = true;
        }

        const config = await getConfiguration();
        if (!config) {
          vscode.window.showErrorMessage(
            "Please configure Notion settings first"
          );
          return;
        }

        const title = await vscode.window.showInputBox({
          prompt: "Enter documentation title",
        });

        if (!title) return;

        // Dokümantasyon şablonu
        const docTemplate = `# Cursor to Notion Documentation Extension

## Project Overview
A VS Code extension that seamlessly integrates Cursor IDE with Notion for real-time documentation management. This extension enables automatic synchronization of documentation between your development environment and Notion workspace.

## Technical Architecture

### Core Components
1. **Notion API Integration**
   - Uses @notionhq/client v2.2.14
   - Real-time synchronization with Notion pages
   - Secure API key management

2. **File System Watcher**
   - Monitors .notion-docs file changes
   - Debounced updates (2-second delay)
   - Automatic synchronization

3. **Command System**
   - Configure: \`cursor_to_notion_docs.configure\`
   - Create Doc: \`cursor_to_notion_docs.createDoc\`
   - Update Doc: \`cursor_to_notion_docs.updateDoc\`

### Configuration Management
- Location: \`~/.cursor/notion-config.json\`
- Stores:
  - Notion API Key
  - Default Page ID
  - User preferences

## Setup Instructions

### Prerequisites
- Node.js >=18.0.0
- VS Code ^1.60.0
- Notion API access

### Installation Steps
1. Install extension in VS Code
2. Run "Notion: Configure Settings"
3. Enter Notion API key
4. Provide target page ID

## Features

### 1. Real-time Documentation Sync
- Automatic updates on file changes
- Markdown support
- Error handling and notifications

### 2. Configuration Management
- Secure credential storage
- Easy setup wizard
- Connection verification

### 3. Document Management
- Create new documentation
- Update existing pages
- Template support

## Usage Guide

### Creating Documentation
1. Command: "Notion: Create New Documentation"
2. Enter document title
3. Edit .notion-docs file
4. Auto-saves to Notion

### Updating Documentation
1. Command: "Notion: Update Existing Documentation"
2. Provide page ID
3. Enter new content
4. Changes sync automatically

## Development

### Project Structure
\`\`\`
cursor-to-notion-docs/
├── src/
│   ├── extension.js       # Main extension logic
│   └── extension.manifest.json
├── package.json          # Dependencies and metadata
├── .notion-docs         # Documentation file
└── README.md            # Project readme
\`\`\`

### Key Functions
- \`setupFileWatcher\`: Monitors document changes
- \`createNotionDoc\`: Creates new Notion pages
- \`updateNotionDoc\`: Updates existing pages
- \`initializeNotion\`: Sets up Notion client

## Error Handling
- API connection failures
- File system errors
- Configuration issues
- Sync conflicts

## Future Enhancements
1. Multiple document support
2. Custom templates
3. Offline mode
4. Version history
5. Collaborative editing

## Support
- GitHub Issues
- Documentation
- Community support

## License
MIT License - Open source and free to use

## Contributors
- Initial development by Cursor team
- Community contributions welcome
`;

        // .notion-docs dosyası oluştur
        await createNotionDocsFile(docTemplate);

        // Setup the file watcher after creating the file
        await setupFileWatcher(title);

        vscode.window.showInformationMessage(
          "Documentation created! File is now being watched for changes."
        );

        // Remove the "Publish" button logic since we're auto-updating now
      } catch (error) {
        vscode.window.showErrorMessage(
          "Failed to create documentation: " + error.message
        );
      }
    }
  );

  const updateDocCommand = vscode.commands.registerCommand(
    "cursor_to_notion_docs.updateDoc",
    // Mevcut updateDoc fonksiyonunu kullanıyoruz
    async () => {
      try {
        if (!initialized) {
          const success = await initializeNotion(vscode.window);
          if (!success) return;
          initialized = true;
        }

        const pageId = await vscode.window.showInputBox({
          prompt: "Enter Notion page ID to update",
        });

        if (!pageId) return;

        const content = await vscode.window.showInputBox({
          prompt: "Enter new content",
        });

        if (!content) return;

        await updateNotionDoc(pageId, content);
        vscode.window.showInformationMessage(
          "Documentation updated in Notion!"
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          "Failed to update documentation: " + error.message
        );
      }
    }
  );

  // Register commands
  context.subscriptions.push(configureCommand);
  context.subscriptions.push(createDocCommand);
  context.subscriptions.push(updateDocCommand);

  // Workspace değiştiğinde yeniden başlat
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      initializeExtension();
    })
  );

  // Mevcut return yapısını koruyoruz
  return {
    "cursor_to_notion_docs.configure": configureCommand,
    "cursor_to_notion_docs.createDoc": createDocCommand,
    "cursor_to_notion_docs.updateDoc": updateDocCommand,
  };
}

function deactivate() {
  if (currentDocWatcher) {
    currentDocWatcher.dispose();
  }
}

module.exports = {
  activate,
  deactivate,
};
