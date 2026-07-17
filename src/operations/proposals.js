import { PROPOSAL_SCHEMA, PROPOSAL_VERSION } from '../constants.js';
import { createId } from '../utils/ids.js';
import { normalizeOperation } from './normalize.js';

export function createProposal({ personaId, summary = '', operations = [], source = {}, analysis = {} }) {
    return {
        $schema: PROPOSAL_SCHEMA,
        proposalVersion: PROPOSAL_VERSION,
        proposalId: createId('proposal'),
        personaId,
        status: 'pending',
        source,
        analysis,
        summary,
        operations: operations.map(normalizeOperation),
        createdAt: new Date().toISOString(),
        supersededBy: null,
    };
}

export function proposalHasPendingOperations(proposal) {
    return Array.isArray(proposal?.operations) && proposal.operations.some(operation => operation.status !== 'accepted' && operation.status !== 'rejected');
}
