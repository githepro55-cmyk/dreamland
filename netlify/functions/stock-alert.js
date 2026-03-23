import { readFile } from "node:fs/promises";
import { cheerio } from "cheerio";

export const config = {
  schedule: "*/5 * * * *"
};

async function loadProducts() {
  const fileUrl = new URL("../../products.json", import.meta.url);
  const raw = await readFile(fileUrl, "utf8");
  return JSON.parse(raw);
}

function detectStock(text) {
  const body = text.toLowerCase();

  const soldOutSignals = [
    "tijdelijk uitverkocht",
    "uitverkocht",
    "niet voorradig",
    "niet beschikbaar",
    "levering aan huis niet beschikbaar"
  ];

  for (const s of soldOutSignals) {
    if (body.includes(s)) {
      return { inStock: false, reason: `Sold-out signaal: ${s}` };
    }
  }

  const positiveSignals = [
    "in winkelmand",
    "toevoegen aan winkelmand",
    "bestel"
  ];

  for (const s of positiveSignals) {
    if (body.includes(s)) {
      return { inStock: true, reason: `Koopsignaal: ${s}` };
    }
  }

  if (body.includes("levering aan huis") && !body.includes("niet beschikbaar")) {
    return { inStock: true, reason: "Levering aan huis lijkt beschikbaar" };
  }

  return { inStock: false, reason: "Geen bruikbaar koopsignaal" };
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    })
  });
}

async function checkProduct(product) {
  const res = await fetch(product.url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "nl-NL,nl;q=0.9,en;q=0.8"
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $("title").text().trim() || product.name;
  const text = $("body").text();
  const state = detectStock(text);

  return {
    id: product.id,
    name: product.name,
    url: product.url,
    title,
    ...state
  };
}

export default async () => {
  const products = await loadProducts();
  const enabled = products.filter(p => p.enabled);
  const hits = [];

  for (const product of enabled) {
    try {
      const result = await checkProduct(product);
      if (result.inStock) hits.push(result);
    } catch {}
  }

  if (hits.length) {
    const lines = ["Dreamland voorraad gevonden:"];
    for (const hit of hits) {
      lines.push(`${hit.name} | ${hit.reason}`);
      lines.push(hit.url);
    }
    await sendTelegram(lines.join("\n"));
  }

  return new Response(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    hits: hits.length
  }), {
    headers: { "content-type": "application/json" }
  });
};
