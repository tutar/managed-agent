import type { AuditRepository } from "./repositories/audit-repository.js";

/**
 * Control-plane audit service.
 *
 * The service assigns timestamps and delegates persistence so orchestration
 * code only needs to describe the audit event semantics.
 */
export const createAuditService = ({ auditRepository }: { auditRepository: AuditRepository }) => {
	return {
		async record(record: { action: string; sessionId: string; userId: string }) {
			await auditRepository.append({
				...record,
				recordedAt: new Date().toISOString(),
			});
		},
		list() {
			return auditRepository.list();
		},
	};
};
