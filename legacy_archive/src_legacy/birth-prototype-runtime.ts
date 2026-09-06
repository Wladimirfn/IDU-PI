import {
	approvePrototypeMaster,
	createPrototypeMasterDraft,
	reviewPrototypeMaster,
	validatePrototypeMaster,
	type BirthPrototypeInput,
	type BirthPrototypeMaster,
	type BirthPrototypeStatus,
} from "./birth-prototype-master.js";
import { readBirthArtifact, writeBirthArtifact } from "./birth-artifacts.js";

export type BirthPrototypeDraftInput = BirthPrototypeInput;

export type BirthPrototypeRuntimeAction = "draft" | "review" | "approve";

export type BirthPrototypeMasterEnvelope = {
	version: 1;
	kind: "birth_prototype_master";
	projectId: string;
	prototype: BirthPrototypeMaster;
};

export type HandleBirthPrototypeMasterInput = {
	action: BirthPrototypeRuntimeAction;
	projectId: string;
	stateRoot: string;
	draft?: BirthPrototypeDraftInput;
	approvedBy?: string;
};

export function handleBirthPrototypeMaster(
	input: HandleBirthPrototypeMasterInput,
): BirthPrototypeMasterEnvelope {
	const existing = readBirthArtifact<BirthPrototypeMaster>(
		input.stateRoot,
		"prototype-master",
	);

	let next: BirthPrototypeMaster;
	if (input.action === "draft") {
		if (!input.draft) {
			throw new Error(
				"draft action requires a draft payload (productIntent, stackRecommendation, etc.)",
			);
		}
		const validation = validatePrototypeMaster(input.draft);
		if (!validation.ok) {
			throw new Error(
				`prototype failed validation: ${validation.missingFields.join(", ")}`,
			);
		}
		next = createPrototypeMasterDraft({
			projectId: input.projectId,
			...input.draft,
		});
	} else if (input.action === "review") {
		if (!existing) {
			throw new Error("cannot review a prototype that does not exist");
		}
		next = reviewPrototypeMaster(existing);
	} else {
		if (!existing) {
			throw new Error("cannot approve a prototype that does not exist");
		}
		if (!input.approvedBy || !input.approvedBy.trim()) {
			throw new Error("approve action requires an approvedBy identifier");
		}
		next = approvePrototypeMaster(existing, input.approvedBy);
	}

	writeBirthArtifact(input.stateRoot, "prototype-master", next);
	return {
		version: 1,
		kind: "birth_prototype_master",
		projectId: input.projectId,
		prototype: next,
	};
}

export function loadPrototypeMaster(
	stateRoot: string,
): BirthPrototypeMaster | undefined {
	return readBirthArtifact<BirthPrototypeMaster>(stateRoot, "prototype-master");
}

export function derivePrototypeStatus(
	stateRoot: string,
): BirthPrototypeStatus {
	const p = readBirthArtifact<BirthPrototypeMaster>(stateRoot, "prototype-master");
	const s = p?.status;
	if (s === "draft" || s === "reviewed" || s === "approved" || s === "stale") {
		return s;
	}
	return "missing";
}
