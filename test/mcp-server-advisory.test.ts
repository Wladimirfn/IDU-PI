import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrchestratorAdvisoriesSection } from '../src/mcp-server.js';
import { runRoleEngineMigration } from '../src/role-engine-config.js';
import type { RoleAdvisory } from '../src/roles/index.js';
import type { CliRuntime } from '../src/cli.js';

describe('T1.7b: MCP pack orchestratorAdvisories section', () => {
  it('includes the orchestratorAdvisories section', () => {
    const mockRuntime = {
      getOrchestratorAdvisory: () => [],
    } as unknown as CliRuntime;

    const section = buildOrchestratorAdvisoriesSection(mockRuntime);

    assert.ok(section, 'Section should exist');
    assert.strictEqual(typeof section, 'object', 'Section should be an object');
  });

  it('orchestratorAdvisories.byRole caps at 5 advisories per role', () => {
    const advisories: RoleAdvisory[] = [];
    // Create 10 advisories for supervisor-main
    for (let i = 0; i < 10; i++) {
      advisories.push({
        roleId: 'supervisor-main',
        priority: 50,
        ts: new Date(Date.now() + i * 1000).toISOString(),
        advisory: `Advisory ${i}`,
        evidenceRefs: [`evidence-${i}`],
      });
    }

    const mockRuntime = {
      getOrchestratorAdvisory: () => advisories,
    } as unknown as CliRuntime;

    const section = buildOrchestratorAdvisoriesSection(mockRuntime) as any;

    assert.strictEqual(section.byRole['supervisor-main'].length, 5, 
      'Should cap at 5 advisories per role');
  });

  it('orchestratorAdvisories.advisoryOnly is true', () => {
    const mockRuntime = {
      getOrchestratorAdvisory: () => [],
    } as unknown as CliRuntime;

    const section = buildOrchestratorAdvisoriesSection(mockRuntime) as any;

    assert.strictEqual(section.advisoryOnly, true, 
      'advisoryOnly should be true');
  });

  it('orchestratorAdvisories.total counts all advisories across roles', () => {
    const advisories: RoleAdvisory[] = [
      {
        roleId: 'supervisor-main',
        priority: 50,
        ts: new Date().toISOString(),
        advisory: 'Advisory 1',
        evidenceRefs: ['evidence-1'],
      },
      {
        roleId: 'supervisor-main',
        priority: 50,
        ts: new Date().toISOString(),
        advisory: 'Advisory 2',
        evidenceRefs: ['evidence-2'],
      },
      {
        roleId: 'supervisor-semantic',
        priority: 50,
        ts: new Date().toISOString(),
        advisory: 'Advisory 3',
        evidenceRefs: ['evidence-3'],
      },
    ];

    const mockRuntime = {
      getOrchestratorAdvisory: () => advisories,
    } as unknown as CliRuntime;

    const section = buildOrchestratorAdvisoriesSection(mockRuntime) as any;

    assert.strictEqual(section.total, 3, 
      'Total should count all advisories across all roles');
  });
});

describe('T1.7b: One-time migration for role-engine.json', () => {
  it('creates role-engine.json with the default config when missing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'role-engine-migration-test-'));
    
    try {
      runRoleEngineMigration(tempDir);

      const configPath = join(tempDir, 'role-engine.json');
      assert.ok(existsSync(configPath), 'role-engine.json should be created');

      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      assert.ok(config.maxRoleInvocationsPerTurn, 'Should have maxRoleInvocationsPerTurn');
      assert.ok(config.roleEnabled, 'Should have roleEnabled');
      assert.strictEqual(typeof config.roleEnabled, 'object', 'roleEnabled should be an object');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing role-engine.json', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'role-engine-migration-test-'));
    
    try {
      const configPath = join(tempDir, 'role-engine.json');
      const existingConfig = {
        maxRoleInvocationsPerTurn: 100,
        roleEnabled: { 'supervisor-main': true },
      };
      
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      runRoleEngineMigration(tempDir);

      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      assert.strictEqual(config.maxRoleInvocationsPerTurn, 100, 
        'Should preserve existing maxRoleInvocationsPerTurn');
      assert.strictEqual(config.roleEnabled['supervisor-main'], true, 
        'Should preserve existing roleEnabled settings');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('the default config has maxRoleInvocationsPerTurn=50 and all 13 roleEnabled entries set to false', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'role-engine-migration-test-'));
    
    try {
      runRoleEngineMigration(tempDir);

      const configPath = join(tempDir, 'role-engine.json');
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      assert.strictEqual(config.maxRoleInvocationsPerTurn, 50, 
        'maxRoleInvocationsPerTurn should be 50');

      const expectedRoles = [
        'supervisor-main',
        'supervisor-semantic',
        'supervisor-compaction',
        'agentlab-security',
        'agentlab-architecture',
        'agentlab-database',
        'agentlab-ui-ux',
        'agentlab-performance',
        'agentlab-code-quality',
        'agentlab-docs',
        'agentlab-project-understanding',
        'agentlab-general',
        'agentlab-librarian',
      ];

      assert.strictEqual(Object.keys(config.roleEnabled).length, 13, 
        'Should have exactly 13 roles');

      for (const role of expectedRoles) {
        assert.strictEqual(config.roleEnabled[role], false, 
          `Role ${role} should be disabled (false)`);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
