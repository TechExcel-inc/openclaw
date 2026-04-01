import { chromium } from "playwright-core";
import type { EadFmNode } from "./types.js";

/**
 * Compiles a project's nodes into a standardized Markdown report.
 */
export function generateMarkdownReport(projectName: string, nodes: EadFmNode[]): string {
  let md = `# EAD-FM Execution Report: ${projectName}\n\n`;
  md += `Generated at: ${new Date().toISOString()}\n\n`;

  if (!nodes || nodes.length === 0) {
    return md + "No nodes defined or executed in this project.";
  }

  nodes.forEach((node, index) => {
    md += `## Node ${index + 1}: ${node.title}\n\n`;

    md += `### Properties\n`;
    md += `- **nodeKey**: ${node.nodeKey}\n`;
    md += `- **type**: ${node.type}\n`;
    if (node.meta) {
      md += `- **meta**: ${node.meta}\n`;
    }

    if (node.testCases && node.testCases.length > 0) {
      md += `\n### Test Cases\n`;
      node.testCases.forEach((tc: { title: string }, tcIdx: number) => {
        md += `${tcIdx + 1}. ${tc.title}\n`;
      });
    }

    md += `\n---\n\n`;
  });

  return md;
}

/**
 * Renders the provided Markdown to a high-quality PDF Buffer using Playwright.
 */
export async function generatePdfReport(markdown: string): Promise<Buffer> {
  // Convert basic markdown to HTML for rendering
  const { marked } = await import("marked");
  const htmlContent = await marked(markdown);

  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #333; line-height: 1.6; }
          h1 { color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; }
          h2 { color: #34495e; margin-top: 30px; }
          h3 { color: #7f8c8d; }
          code { background: #f4f4f4; padding: 2px 5px; border-radius: 4px; }
          pre code { display: block; padding: 15px; overflow-x: auto; background: #f8f9fa; border: 1px solid #eaeded; }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `;

  // Launch headless browser to render PDF
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(fullHtml, { waitUntil: "networkidle" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
  });

  await browser.close();
  return Buffer.from(pdfBuffer);
}
