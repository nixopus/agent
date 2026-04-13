import { eq, and, sql, desc } from 'drizzle-orm';
import { deployPatterns, deployOutcomes } from '../../db/schema';
import { createLogger } from '../../logger';

const logger = createLogger('pattern-store');

type Db = Parameters<typeof eq>[0] extends never ? never : ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>;

export interface DeployPattern {
  ecosystem: string;
  framework?: string;
  patternType: 'failure_fix' | 'fast_path' | 'pitfall';
  signature: string;
  resolution: string;
  confidence: number;
  hitCount: number;
}

export interface DeployOutcome {
  orgId?: string;
  applicationId?: string;
  ecosystem: string;
  framework?: string;
  source?: string;
  outcome: 'success' | 'failed' | 'rollback';
  stepsCount?: number;
  selfHealAttempts?: number;
  failureSignatures?: string[];
  fixesApplied?: string[];
  metadata?: Record<string, unknown>;
}

const MAX_PATTERNS_PER_QUERY = 15;
const MIN_CONFIDENCE_THRESHOLD = 0.3;

export class PatternStore {
  constructor(private db: Db) {}

  async getPatterns(ecosystem: string, framework?: string): Promise<DeployPattern[]> {
    try {
      const rows = await (this.db as any)
        .select()
        .from(deployPatterns)
        .where(
          and(
            eq(deployPatterns.ecosystem, ecosystem.toLowerCase()),
            sql`${deployPatterns.confidence} >= ${MIN_CONFIDENCE_THRESHOLD}`,
          ),
        )
        .orderBy(desc(deployPatterns.confidence))
        .limit(MAX_PATTERNS_PER_QUERY);

      return rows.map((r: any) => ({
        ecosystem: r.ecosystem,
        framework: r.framework,
        patternType: r.patternType,
        signature: r.signature,
        resolution: r.resolution,
        confidence: r.confidence,
        hitCount: r.hitCount,
      }));
    } catch (err) {
      logger.warn({ err, ecosystem }, 'failed to query deploy patterns');
      return [];
    }
  }

  async recordOutcome(outcome: DeployOutcome): Promise<void> {
    try {
      await (this.db as any).insert(deployOutcomes).values({
        orgId: outcome.orgId,
        applicationId: outcome.applicationId,
        ecosystem: outcome.ecosystem.toLowerCase(),
        framework: outcome.framework?.toLowerCase(),
        source: outcome.source,
        outcome: outcome.outcome,
        stepsCount: outcome.stepsCount,
        selfHealAttempts: outcome.selfHealAttempts,
        failureSignatures: outcome.failureSignatures ?? [],
        fixesApplied: outcome.fixesApplied ?? [],
        metadata: outcome.metadata ?? {},
      });
    } catch (err) {
      logger.warn({ err }, 'failed to record deploy outcome');
    }
  }

  async upsertPattern(
    ecosystem: string,
    patternType: DeployPattern['patternType'],
    signature: string,
    resolution: string,
    succeeded: boolean,
  ): Promise<void> {
    const eco = ecosystem.toLowerCase();
    try {
      await (this.db as any)
        .insert(deployPatterns)
        .values({
          ecosystem: eco,
          patternType,
          signature,
          resolution,
          confidence: succeeded ? 1.0 : 0.0,
          hitCount: succeeded ? 1 : 0,
          missCount: succeeded ? 0 : 1,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [deployPatterns.ecosystem, deployPatterns.patternType, deployPatterns.signature],
          set: {
            resolution: succeeded ? resolution : sql`${deployPatterns.resolution}`,
            hitCount: succeeded
              ? sql`${deployPatterns.hitCount} + 1`
              : sql`${deployPatterns.hitCount}`,
            missCount: succeeded
              ? sql`${deployPatterns.missCount}`
              : sql`${deployPatterns.missCount} + 1`,
            confidence: sql`
              CASE WHEN (${deployPatterns.hitCount} + ${deployPatterns.missCount} + 1) > 0
              THEN (${deployPatterns.hitCount} + ${succeeded ? 1 : 0})::real
                   / (${deployPatterns.hitCount} + ${deployPatterns.missCount} + 1)::real
              ELSE 0.5 END
            `,
            lastSeenAt: new Date(),
          },
        });
    } catch (err) {
      logger.warn({ err, ecosystem: eco, signature }, 'failed to upsert deploy pattern');
    }
  }
}

export function formatPatternsBlock(patterns: DeployPattern[]): string {
  if (patterns.length === 0) return '';

  const grouped: Record<string, DeployPattern[]> = {};
  for (const p of patterns) {
    (grouped[p.patternType] ??= []).push(p);
  }

  const sections: string[] = [];

  if (grouped.failure_fix?.length) {
    const lines = grouped.failure_fix.map(
      (p) => `- "${p.signature}" → ${p.resolution} (confidence:${(p.confidence * 100).toFixed(0)}%, seen:${p.hitCount})`,
    );
    sections.push(`known_fixes:\n${lines.join('\n')}`);
  }

  if (grouped.pitfall?.length) {
    const lines = grouped.pitfall.map(
      (p) => `- ${p.signature}: ${p.resolution} (confidence:${(p.confidence * 100).toFixed(0)}%)`,
    );
    sections.push(`pitfalls:\n${lines.join('\n')}`);
  }

  if (grouped.fast_path?.length) {
    const lines = grouped.fast_path.map(
      (p) => `- ${p.signature}: ${p.resolution}`,
    );
    sections.push(`fast_paths:\n${lines.join('\n')}`);
  }

  const eco = patterns[0].ecosystem;
  return `[deploy-patterns] ecosystem:${eco}\n${sections.join('\n')}\n[/deploy-patterns]`;
}
