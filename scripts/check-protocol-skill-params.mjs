import { readFileSync } from "node:fs";
import { TOOLS } from "../dist/src/mcp-server.js";

const doc = readFileSync("skills-bundle/idu-pi-parent-protocol/SKILL.md", "utf8");
const rows = doc.split("\n").filter((l) => l.startsWith("| `idu_"));

let bad = 0;
let checked = 0;

for (const row of rows) {
	const cells = row.split("|").map((c) => c.trim());
	const name = cells[1]?.replace(/`/g, "");
	const claimedCell = cells[3] ?? "";
	if (!name) continue;
	const tool = TOOLS.find((t) => t.name === name);
	checked++;

	if (!tool) {
		console.log(`  LA SKILL NOMBRA UN TOOL QUE NO EXISTE: ${name}`);
		bad++;
		continue;
	}

	const required = tool.inputSchema?.required ?? [];
	const claimed =
		claimedCell === "none" || claimedCell === "—"
			? []
			: (claimedCell.match(/`(\w+)`/g) ?? []).map((s) => s.replace(/`/g, ""));

	const missing = required.filter((r) => !claimed.includes(r));
	const invented = claimed.filter((c) => tool.inputSchema?.properties?.[c] === undefined);

	if (missing.length || invented.length) {
		console.log(`  DESAJUSTE ${name}`);
		console.log(`    schema exige : ${JSON.stringify(required)}`);
		console.log(`    la skill dice: ${JSON.stringify(claimed)}`);
		if (missing.length) console.log(`    FALTA en la skill: ${missing.join(", ")}`);
		if (invented.length) console.log(`    NO EXISTE en el schema: ${invented.join(", ")}`);
		bad++;
	}
}

console.log("");
console.log(`filas revisadas: ${checked} | con problema: ${bad}`);
console.log(bad === 0 ? "OK: la tabla de la skill coincide con el schema real." : "HAY QUE CORREGIR");
process.exit(bad === 0 ? 0 : 1);
