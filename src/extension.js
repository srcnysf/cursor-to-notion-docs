const vscode = require("vscode");
const { Client } = require("@notionhq/client");
const path = require("path");
const fs = require("fs").promises;
const dotenv = require("dotenv");
const os = require("os");

// Global değişkenleri tanımla
let notion = null;
let currentDocWatcher = null;
let currentTitle = null;
let debounceTimer = null;
let initialized = false;

// URL'den page ID çıkaran yardımcı fonksiyon
function extractPageIdFromUrl(pageUrl) {
  try {
    let pageId;

    // URL'den query parametrelerini temizle
    const urlWithoutQuery = pageUrl.split("?")[0];

    // Farklı URL formatlarını kontrol et
    if (urlWithoutQuery.includes("-")) {
      // Format: workspace/Page-Name-ID
      const urlParts = urlWithoutQuery.split("-");
      pageId = urlParts[urlParts.length - 1];
    } else {
      // Format: workspace/PageName-ID veya workspace/ID
      const lastPart = urlWithoutQuery.split("/").pop();

      // Eğer son kısımda tire varsa, son parçayı al
      if (lastPart.includes("-")) {
        pageId = lastPart.split("-").pop();
      } else {
        pageId = lastPart;
      }
    }

    // Sadece alfanumerik karakterleri tut
    pageId = pageId.replace(/[^a-zA-Z0-9]/g, "");

    // ID uzunluğunu kontrol et (Notion ID'leri 32 karakter)
    if (pageId.length !== 32) {
      throw new Error("Invalid Notion page URL format");
    }

    return pageId;
  } catch (error) {
    throw new Error(
      "Could not extract page ID from URL. Please make sure you copied the entire Notion page URL."
    );
  }
}

// Configuration management fonksiyonlarını güncelle
async function getGlobalConfiguration() {
  try {
    const configPath = path.join(
      os.homedir(),
      ".cursor",
      "notion-global-config.json"
    );
    const config = await fs.readFile(configPath, "utf8");
    return JSON.parse(config);
  } catch (error) {
    return null;
  }
}

async function saveGlobalConfiguration(config) {
  const configPath = path.join(
    os.homedir(),
    ".cursor",
    "notion-global-config.json"
  );
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function getProjectConfiguration() {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error("No workspace folder open");
    }

    const configPath = path.join(
      workspaceFolders[0].uri.fsPath,
      ".notion-config.json"
    );
    const config = await fs.readFile(configPath, "utf8");
    return JSON.parse(config);
  } catch (error) {
    return null;
  }
}

async function saveProjectConfiguration(config) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error("No workspace folder open");
  }

  const configPath = path.join(
    workspaceFolders[0].uri.fsPath,
    ".notion-config.json"
  );
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

// setupWizard fonksiyonunu güncelle
async function setupWizard(window) {
  // Önce global config'i kontrol et
  let globalConfig = await getGlobalConfiguration();

  // API key yoksa iste
  if (!globalConfig || !globalConfig.NOTION_API_KEY) {
    globalConfig = { NOTION_API_KEY: null };

    const apiKey = await window.showInputBox({
      prompt:
        "Enter your Notion API Key (from https://www.notion.so/my-integrations)",
      placeHolder: "secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    if (!apiKey) {
      throw new Error("Notion API Key is required");
    }

    globalConfig.NOTION_API_KEY = apiKey;
    await saveGlobalConfiguration(globalConfig);
  }

  // Her durumda yeni page URL'si iste
  const pageUrl = await window.showInputBox({
    prompt: "Enter your Notion page URL for this project",
    placeHolder: "https://www.notion.so/workspace/Your-Page-Name-123456789...",
  });

  if (!pageUrl) {
    throw new Error("Notion Page URL is required");
  }

  // Proje konfigürasyonunu kaydet
  const projectConfig = {
    NOTION_PAGE_ID: extractPageIdFromUrl(pageUrl),
  };
  await saveProjectConfiguration(projectConfig);

  // İlk konfigürasyondan sonra otomatik olarak .notion-docs oluştur
  const defaultTemplate = `# ${
    vscode.workspace.name || "Project"
  } Documentation\n\n${getDefaultTemplate()}`;
  await createNotionDocsFile(defaultTemplate);
  await setupFileWatcher("Documentation", projectConfig.NOTION_PAGE_ID);

  // Her iki config'i birleştirip dön
  return {
    ...globalConfig,
    ...projectConfig,
  };
}

// createDocCommand'ı güncelle - URL'yi bir kez soracak şekilde
const createDocCommand = vscode.commands.registerCommand(
  "cursor_to_notion_docs.createDoc",
  async () => {
    try {
      if (!initialized) {
        const success = await initializeNotion(vscode.window);
        if (!success) return;
        initialized = true;
      }

      const title = await vscode.window.showInputBox({
        prompt: "Enter documentation title",
      });

      if (!title) return;

      // Proje konfigürasyonunu kontrol et
      let projectConfig = await getProjectConfiguration();

      // Eğer proje konfigürasyonu yoksa veya page ID eksikse, sadece o zaman URL iste
      if (!projectConfig || !projectConfig.NOTION_PAGE_ID) {
        const pageUrl = await vscode.window.showInputBox({
          prompt: "Enter the Notion page URL for this documentation",
          placeHolder:
            "https://www.notion.so/workspace/Your-Page-Name-123456789...",
        });

        if (!pageUrl) {
          throw new Error("Notion Page URL is required");
        }

        projectConfig = {
          NOTION_PAGE_ID: extractPageIdFromUrl(pageUrl),
        };
        await saveProjectConfiguration(projectConfig);
      }

      // Dokümantasyon şablonu oluştur
      const docTemplate = `# ${title}\n\n${getDefaultTemplate()}`;

      // .notion-docs dosyası oluştur
      await createNotionDocsFile(docTemplate);

      // File watcher'ı kur
      await setupFileWatcher(title, projectConfig.NOTION_PAGE_ID);

      vscode.window.showInformationMessage(
        "Documentation created! File is now being watched for changes."
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        "Failed to create documentation: " + error.message
      );
    }
  }
);

// Şablon içeriğini ayrı bir fonksiyona al
function getDefaultTemplate() {
  return `## Project Overview
A VS Code extension that seamlessly integrates Cursor IDE with Notion for real-time documentation management...`;
  // ... (mevcut şablon içeriği)
}

// Initialize Notion client
async function initializeNotion(window) {
  try {
    let globalConfig = await getGlobalConfiguration();
    let projectConfig = await getProjectConfiguration();

    // Global config yoksa veya API key eksikse setup wizard'ı çalıştır
    if (!globalConfig || !globalConfig.NOTION_API_KEY) {
      const config = await setupWizard(window);
      globalConfig = { NOTION_API_KEY: config.NOTION_API_KEY };
    }

    // Proje config'i yoksa veya page ID eksikse sadece page ID iste
    if (!projectConfig || !projectConfig.NOTION_PAGE_ID) {
      const pageUrl = await window.showInputBox({
        prompt: "Enter your Notion page URL for this project",
        placeHolder:
          "https://www.notion.so/workspace/Your-Page-Name-123456789...",
      });

      if (!pageUrl) {
        throw new Error("Notion Page URL is required");
      }

      projectConfig = { NOTION_PAGE_ID: extractPageIdFromUrl(pageUrl) };
      await saveProjectConfiguration(projectConfig);
    }

    // Notion client'ı oluştur
    notion = new Client({
      auth: globalConfig.NOTION_API_KEY,
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

async function setupFileWatcher(title, pageId) {
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
        // getConfiguration yerine global ve proje konfigürasyonlarını kullan
        const globalConfig = await getGlobalConfiguration();
        const projectConfig = await getProjectConfiguration();

        if (!globalConfig || !projectConfig) {
          throw new Error("Notion configuration not found");
        }

        const content = await fs.readFile(notionDocsPath, "utf8");

        // pageId parametresini veya proje konfigürasyonundaki ID'yi kullan
        const targetPageId = pageId || projectConfig.NOTION_PAGE_ID;

        await updateNotionDoc(targetPageId, content);
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
