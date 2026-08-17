# Contract Lab 1 — Implementation Report

## Purpose

Implements the Architecture v2.0 Save Contract qualification layer. The goal is to determine whether AIDP can be driven safely at the annotation-document save-contract layer instead of using immediate React/Neeko/Wave settlement as persistence truth.

## Runtime

- runtime `0.7.9-contractlab.1`
- manifest `0.7.9.44`
- Side Panel only
- manifest content script: `content.js` only
- normal production ③ mutation path disabled
- AIDP `暫存` / `提交` never automated

## Implemented modules

`canonical_document.js`, `raw_document_capture.js`, `privacy.js`, `save_contract_observer.js`, `save_contract_profiler.js`, `save_contract_mapper.js`, `save_transport*.js`, `reload_verifier.js`, `capability_gate.js`, `journal_v2.js`, `qualification_fixtures.js`, `qualification_report.js`, `qualification_runner.js`, `contract_lab_main.js`, `contract_lab_worker.js`.

## Main safety rules

- Q0 observes two genuine AIDP `SubmitTempItemAnswer` contracts before direct dispatch can qualify.
- Existing raw region objects are cloned; unknown/opaque metadata and unchanged precision are preserved.
- `data.regions` and `dataMap.regions` are independently mapped.
- Immediate pre-write client-side CAS checks case identity and canonical source state.
- `SAVE_INVOKE_INTENT` is journaled before dispatch; a logical save is never resent after invocation.
- Persistence verdict comes from reload-derived Model+Table canonical equality. Wave is not persistence authority.
- Transport timeout/unknown state never triggers automatic retry.
- Unknown/partial state is STOP-FIRST; ordinary reset cannot clear unresolved write state.
- Cleanup/restore is blocked after unqualified transport unless the preceding request is definitively settled and reload state is known.
- An unresolved Contract Lab job in any AIDP tab blocks a new write from all tabs.
- Native add-ID allocator can only be followed by another write when its AIDP save is settled and matches reload state.
- Speaker probes preserve contiguous retained speaker numbering.
- Q8 can use add only through a Q6-qualified ID path.

## Qualification gates

Q0 contract observation → Q1 no-op → Q2 text → Q3 timing → Q4 speaker/voice → Q5 delete → Q6 add/ID issuance → Q7 split → Q8 mixed document save.

## Local validation

- root active JavaScript syntax: PASS
- current test suite: **45/45 PASS**
- ZIP integrity: PASS

## Not yet proven

No live AIDP Q0-Q8 qualification has been run. This is a qualification laboratory, not a production Save Contract executor.

The prior beta42 structural-delete result is still unknown; first live action must be reload + fresh read-only case ZIP export, not Q0 or an old structural patch.
