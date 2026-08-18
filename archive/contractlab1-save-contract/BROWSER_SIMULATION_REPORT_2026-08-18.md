# Contract Lab Browser Simulation Report

Date: 2026-08-18
Build tested locally: `0.7.9-contractlab.1`

## Purpose

Static/unit testsだけでなく、ブラウザ上にAIDP相当の模擬環境を構築し、主要なread/write/reload経路が実際に連続動作することを確認した。

## Mock environment

Chromium headless上の`about:blank`に、次を構築した。

- 12 regions
- pagination: 10 + 2
- AIDP Table互換DOM classes
- textarea `neeko-input-textarea`
- React-like `__reactFiber$...` / `__reactProps$...`
- `newResult.data.regions`
- `newResult.dataMap.regions`
- textarea React `onChange`
- `/api/dispatch/SubmitTempItemAnswer`相当のmock save transport
- server-derived persistence相当の`window.name` state
- reload後のstate reconstruction

Container policyがlocalhost navigationとunpacked extension loadingを禁止しているため、HTTP server/extension loaderそのものではなく、同一Chromium runtime内にmock page/transportを構築した。

## Result

### 1. Full Table capture
PASS
- total: 12
- page 1: 10
- page 2: 2
- original pageへの復帰成功

### 2. Raw document capture
PASS
- `data.regions`: 12
- `dataMap.regions`: 12

### 3. Q0 development probe
PASS
- safe target: `region_2`
- before: `字幕2`
- requested: `字幕2〔SIM-Q0〕`
- textarea/data/dataMap convergence: PASS

### 4. Save Contract observation
PASS
- endpoint: `/api/dispatch/SubmitTempItemAnswer`
- HTTP: 200
- application status: 0
- sensitive header values persisted: none

### 5. Q0 reload persistence
PASS
- reload reconstruction after probe: `字幕2〔SIM-Q0〕`

### 6. Full-document dispatch
PASS
- target: `region_5`
- desired text: `FULLDOC-SIMULATION-OK`
- HTTP: 200
- application status: 0

### 7. Full-document reload verification
PASS
- reload後Table textarea: `FULLDOC-SIMULATION-OK`

## Overall

`SIMULATION_PASS`

この結果は、Contract Labの主要経路がブラウザDOM/React-like state/save transport/reload persistenceをまたいで連続動作できることを示す。

ただし、本物のAIDP内部contractとの同一性を証明するものではない。実AIDPではQ0 multi-case observationを実行し、実際のrequest envelope、response semantics、field classificationをqualificationする必要がある。

## Repository identity note

`main/current`には既にmanifest `0.7.9.44`のContract Lab 1記録が存在する。今回のローカル検証ZIPは`version_name=0.7.9-contractlab.1`だがmanifest数値が`0.7.9`であり、既存tracked buildと同一binaryとは扱わない。このreportはbrowser-level simulation evidenceとして追加し、既存current build identityを上書きしない。