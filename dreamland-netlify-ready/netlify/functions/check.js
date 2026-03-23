import { readFile } from "node:fs/promises";
import { cheerio } from "cheerio";

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
    ...state,
    checkedAt: new Date().toISOString()
  };
}

export default async () => {
  try {
    const products = await loadProducts();
    const enabled = products.filter(p => p.enabled);
    const results = [];

    for (const product of enabled) {
      try {
        results.push(await checkProduct(product));
      } catch (e) {
        results.push({
          id: product.id,
          name: product.name,
          url: product.url,
          inStock: false,
          reason: `Fout: ${e.message}`,
          checkedAt: new Date().toISOString()
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, products: results }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
