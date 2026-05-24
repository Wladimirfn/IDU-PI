export type UserEmotion =
	| "neutral"
	| "molesto"
	| "frustrado"
	| "urgente"
	| "cansado"
	| "feliz"
	| "confundido";

export type UserSignalConfidence = "high" | "medium" | "low";

export interface UserSignal {
	emotion: UserEmotion;
	urgency: number;
	confidence: UserSignalConfidence;
	matchedKeywords: string[];
}

interface EmotionRule {
	emotion: Exclude<UserEmotion, "neutral">;
	urgency: number;
	keywords: string[];
}

const RULES: EmotionRule[] = [
	{
		emotion: "urgente",
		urgency: 5,
		keywords: [
			"urgente",
			"crítico",
			"critico",
			"se cayó",
			"se cayo",
			"no funciona",
			"ya",
			"ahora",
			"asap",
			"urgent",
			"critical",
			"immediately",
		],
	},
	{
		emotion: "molesto",
		urgency: 4,
		keywords: [
			"por la mierda",
			"por la mirda",
			"mierda",
			"maldita",
			"harto",
			"harta",
		],
	},
	{
		emotion: "molesto",
		urgency: 4,
		keywords: [
			"otra vez",
			"nuevamente",
			"nuevamnet",
			"de nuevo",
			"sigue fallando",
			"volvió a fallar",
			"volvio a fallar",
			"falla recurrente",
			"keeps failing",
			"still failing",
			"again",
			"molesto",
			"me tiene cansado",
		],
	},
	{
		emotion: "cansado",
		urgency: 3,
		keywords: ["cansado", "agotado"],
	},
	{
		emotion: "frustrado",
		urgency: 4,
		keywords: ["frustrado", "frustrada", "frustrating", "frustrated"],
	},
	{
		emotion: "confundido",
		urgency: 3,
		keywords: ["no entiendo", "confundido", "no me queda claro"],
	},
	{
		emotion: "feliz",
		urgency: 2,
		keywords: ["bien", "excelente", "perfecto", "gracias"],
	},
];

export function analyzeUserSignal(text: string): UserSignal {
	const normalized = text.toLocaleLowerCase("es");
	const matches = RULES.map((rule) => ({
		...rule,
		matchedKeywords: rule.keywords.filter((keyword) =>
			normalized.includes(keyword),
		),
	})).filter((rule) => rule.matchedKeywords.length > 0);

	if (!matches.length) {
		return {
			emotion: "neutral",
			urgency: 1,
			confidence: "low",
			matchedKeywords: [],
		};
	}

	const strongest = matches.reduce((best, current) =>
		current.urgency > best.urgency ? current : best,
	);
	const matchedKeywords = matches.flatMap((match) => match.matchedKeywords);

	return {
		emotion: strongest.emotion,
		urgency: strongest.urgency,
		confidence: matchedKeywords.length >= 2 ? "high" : "medium",
		matchedKeywords: [...new Set(matchedKeywords)],
	};
}
