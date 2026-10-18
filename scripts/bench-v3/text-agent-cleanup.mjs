export function textAgentCleanup(sourceDocuments, controlDocuments, windowServerMatches) {
	if (![sourceDocuments, controlDocuments].every((count) => Number.isInteger(count) && count >= 0))
		throw new Error("invalid owned document count");
	return {
		leftover: sourceDocuments > 0 || controlDocuments > 0,
		source_documents: sourceDocuments,
		control_documents: controlDocuments,
		windowserver_matches: windowServerMatches,
	};
}
