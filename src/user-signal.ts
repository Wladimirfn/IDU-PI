export type UserEmotion =
	| "neutral"
	| "molesto"
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
		],
	},
	{
		emotion: "molesto",
		urgency: 4,
		keywords: ["harto", "otra vez", "molesto", "me tiene cansado"],
	},
	{
		emotion: "cansado",
		urgency: 3,
		keywords: ["cansado", "agotado"],
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
