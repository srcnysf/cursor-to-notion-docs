const { Client } = require("@notionhq/client");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs").promises;
const vscode = require("vscode");

let notion;

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

// Create documentation
async function createNotionDoc(title, content, pageId) {
  const response = await notion.pages.create({
    parent: {
      page_id: pageId,
    },
    properties: {
      title: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
    },
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: content,
              },
            },
          ],
        },
      },
    ],
  });
  return response;
}

// Update documentation
async function updateNotionDoc(pageId, content) {
  const response = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: content,
              },
            },
          ],
        },
      },
    ],
  });
  return response;
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

function activate(context) {
  let initialized = false;

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
        const docTemplate = `# ${title}

## Description
[Enter description here]

## Features
- [Feature 1]
- [Feature 2]
- [Feature 3]

## Usage
[Usage instructions here]

## Examples
\`\`\`
[Code examples here]
\`\`\`

## Additional Notes
[Any additional notes here]
`;

        // .notion-docs dosyası oluştur
        await createNotionDocsFile(docTemplate);

        // Kullanıcının düzenlemesi için bekle
        const shouldPublish = await vscode.window.showInformationMessage(
          'Documentation template created! Edit the file and click "Publish" when ready.',
          "Publish"
        );

        if (shouldPublish === "Publish") {
          // Dosyayı oku
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const notionDocsPath = path.join(
            workspaceFolders[0].uri.fsPath,
            ".notion-docs"
          );
          const content = await fs.readFile(notionDocsPath, "utf8");

          // Notion'a gönder
          await createNotionDoc(title, content, config.NOTION_PAGE_ID);
          vscode.window.showInformationMessage(
            "Documentation published to Notion!"
          );
        }
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

  // Mevcut return yapısını koruyoruz
  return {
    "cursor_to_notion_docs.configure": configureCommand,
    "cursor_to_notion_docs.createDoc": createDocCommand,
    "cursor_to_notion_docs.updateDoc": updateDocCommand,
  };
}

module.exports = {
  activate,
};
