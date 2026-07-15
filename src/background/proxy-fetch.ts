// Service-worker handler for FLORA_PROXY_FETCH. MV3 content scripts get no
// host-permission CORS bypass, so every cross-origin fetch is routed here and
// executed in the background context (see the context branch in each shared
// module: openaccess, pubpeer-api, doi-validate, doi-augment).

import type {DoiString} from "@shared/types";
import type {ProxyFetchRequest, ProxyFetchResponse} from "@shared/messages";
import {fetchOpenAccessRaw} from "@shared/openaccess";
import {lookupPubPeerRaw, PubPeerRateLimitError} from "@shared/pubpeer-api";
import {validateDOIsRaw} from "@shared/doi-validate";
import {fetchTitleByDoiRaw} from "@shared/doi-augment";

/** Run the requested cross-origin fetch and return a serializable result. */
export async function handleProxyFetch(
    request: ProxyFetchRequest
): Promise<ProxyFetchResponse> {
    try {
        switch (request.fetcher) {
            case "openAccess": {
                const [doi, email] = request.args as [string, string];
                const data = await fetchOpenAccessRaw(doi, email);
                return {type: "FLORA_PROXY_FETCH_RESULT", ok: true, data};
            }
            case "pubpeer": {
                const [dois, urls] = request.args as [string[], string[]];
                try {
                    const data = await lookupPubPeerRaw(dois, urls);
                    return {type: "FLORA_PROXY_FETCH_RESULT", ok: true, data};
                } catch (err) {
                    if (err instanceof PubPeerRateLimitError) {
                        return {
                            type: "FLORA_PROXY_FETCH_RESULT",
                            ok: false,
                            error: err.message,
                            rateLimitMs: err.retryAfterMs,
                        };
                    }
                    throw err;
                }
            }
            case "validateDois": {
                const [dois] = request.args as [DoiString[]];
                const data = await validateDOIsRaw(dois);
                return {type: "FLORA_PROXY_FETCH_RESULT", ok: true, data};
            }
            case "titleByDoi": {
                const [doi] = request.args as [string];
                const data = await fetchTitleByDoiRaw(doi);
                return {type: "FLORA_PROXY_FETCH_RESULT", ok: true, data};
            }
            default:
                return {
                    type: "FLORA_PROXY_FETCH_RESULT",
                    ok: false,
                    error: `Unknown proxy fetcher: ${(request as {fetcher?: string}).fetcher}`,
                };
        }
    } catch (err) {
        return {
            type: "FLORA_PROXY_FETCH_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "Proxy fetch failed",
        };
    }
}
