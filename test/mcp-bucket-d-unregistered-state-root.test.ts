import assert from "node:assert/strict";
import { test } from "node:test";
import { callIduMcpTool } from "../src/mcp-server.js";
import {
	getRoleEngineSubscriptionStatus,
	unbindRoleEngineSubscription,
} from "../src/role-engine-subscription.js";
import {
	UNREGISTERED_PROJECT_ID,
	ROLE_ENGINE_PROBE,
	unregisteredResolution,
	makeRuntime,
	ENVELOPE_SITES,
} from "./helpers/bucket-d-setup.js";

// Test-of-record for the 9 BUCKET-D "unregistered" sites.
// Phase 1A (issue #258, type:chore). NO production change in this phase.
//
// These tests pin TODAY's behavior so the sibling coercion work
// (Phase 2, the 13 gate sites, issue #257) has a regression net for the
// 9 sites that must NEVER be coerced — they genuinely have no state.
//
// IMPORTANT ASYMMETRY — two families, two expected values:
//
//   1. ENVELOPE sites (7): the handlers return through the shared
//      `envelope()` helper (src/mcp/_shared/index.ts). `envelope()` runs a
//      truthy coercion — `inputStateRoot ? inputStateRoot : null` — so the
//      literal `""` collapses to `null` on the wire. We assert
//      `result.stateRoot === null`.
//
//   2. role-engine-subscription sites (2): `unbindRoleEngineSubscription`
//      and `getRoleEngineSubscriptionStatus` return their OWN shape
//      (`RoleEngineSubscriptionStatus`), NOT the shared envelope. There is
//      no coercion, so the literal `""` stays `""`. We assert
//      `status.stateRoot === ""` (NOT null).
//
// Out of scope (Phase 1B / Phase 2): the 13 master-plan + supervisor gate
// sites that DO have a real stateRoot but guard on a capability.

// The 7 envelope sites. Each guards on `!resolution.stateRoot` (or
// `status !== "registered_project"`) and returns
// `envelope({ stateRoot: "" })` which coerces to `null`.
for (const site of ENVELOPE_SITES) {
	test(`[bucket-d 1A] ${site.tool} unregistered emits stateRoot=null`, async () => {
		const result = await callIduMcpTool(
			site.tool,
			{ ...site.args },
			{
				projectResolver: () => unregisteredResolution(),
				runtimeFactory: () => makeRuntime(),
			},
		);

		// envelope() truthy-coerces the literal "" → null (REQ-BD1A-1).
		assert.equal(result.stateRoot, null);
		// Confirms the guard-failure branch was taken (these are not success paths).
		assert.equal(result.ok, false);
	});
}

// The 2 role-engine-subscription sites. These return their OWN shape, not
// the shared envelope — so the literal "" stays "" (no truthy coercion).
// The unregistered branch is hit when there is no active binding for the
// given projectId in the module-level `bindingsByProjectId` map.
//
// The probe id is unique to this file and never bound, so the unbound
// branch is deterministic regardless of test ordering.
test("[bucket-d 1A] unbindRoleEngineSubscription unbound returns literal empty stateRoot", () => {
	const status = unbindRoleEngineSubscription(ROLE_ENGINE_PROBE);

	// NOT null: role-engine-subscription returns its own
	// RoleEngineSubscriptionStatus shape directly (no envelope() coercion).
	// The literal "" at src/role-engine-subscription.ts:99 is preserved.
	assert.equal(status.stateRoot, "");
	assert.equal(status.rebound, false);
});

test("[bucket-d 1A] getRoleEngineSubscriptionStatus unbound returns literal empty stateRoot", () => {
	const status = getRoleEngineSubscriptionStatus(ROLE_ENGINE_PROBE);

	// NOT null: same asymmetry — own shape, no envelope coercion.
	// The literal "" at src/role-engine-subscription.ts:125 is preserved.
	assert.equal(status.stateRoot, "");
});
