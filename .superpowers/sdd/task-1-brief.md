### Task 1: Fork 浠撳簱鑴氭墜鏋?
**Files:**
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\package.json`
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\cordis.patch.yml`
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\LICENSE`(MIT,淇濈暀涓婃父鐗堟潈澶?
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\README.md`
- Copy: `src/index.mjs`銆乣client.js` 浠?`C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\` 澶嶅埗鍒颁粨搴?
**Interfaces:**
- Consumes: 涓婃父 npm 鍖?`dsh-approval-gate@0.5.0` 宸插畨瑁呬簬 profile node_modules
- Produces: 鍙姞杞界殑鎻掍欢楠ㄦ灦(鍏堜笉鍋氫换浣曡涓烘敼鍔?,鍚庣画浠诲姟鍦ㄥ叾涓婃敼閫?
- [ ] **Step 1: 寤虹洰褰曞苟澶嶅埗涓婃父婧愮爜**

```powershell
New-Item -ItemType Directory -Force 'C:\Users\LIULU\Desktop\dsh-approval-core\src'
Copy-Item 'C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\src\index.mjs' 'C:\Users\LIULU\Desktop\dsh-approval-core\src\index.mjs'
Copy-Item 'C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\client.js' 'C:\Users\LIULU\Desktop\dsh-approval-core\client.js'
```

- [ ] **Step 2: 鍐?package.json(鏀瑰悕 + 淇濇寔闆朵緷璧?**

```json
{
  "name": "dsh-approval-core",
  "version": "0.1.0",
  "description": "鑷姩瀹℃壒鍐崇瓥绠￠亾:渚嬭鏀捐銆佸嵄闄╄浆浜哄伐(fail-safe),瀛︿範鍙楃害鏉?fork dsh-approval-gate 鍔犲浐鐗?,
  "type": "module",
  "main": "./src/index.mjs",
  "exports": {
    ".": "./src/index.mjs",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "files": ["src", "client.js", "cordis.patch.yml", "README.md", "LICENSE"],
  "scripts": {
    "test": "node --test",
    "check": "node --check src/index.mjs && node --check src/danger-patterns.mjs && node --check src/classifier.mjs && node --check src/learning.mjs && node --check client.js"
  },
  "keywords": ["deepseek-harness", "dsh", "dsh-plugin", "approval", "鑷姩瀹℃壒"],
  "license": "MIT",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  },
  "peerDependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "devDependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  }
}
```

- [ ] **Step 3: 鍐?cordis.patch.yml(鐓ф妱涓婃父,浠呮敼鍚?**

```yaml
# dsh-approval-core bundle patch: inserts the plugin row.
# NOTE: the 'auto-approve' permission preset must exist in the profile's
# cordis.patch.yml (already configured on this machine).
- insert:
    - id: dsh-approval-core
      name: 'dsh-approval-core'
```

- [ ] **Step 4: 澶嶅埗 LICENSE(MIT,淇濈暀涓婃父鐗堟潈澹版槑)骞跺湪棣栬娉ㄩ噴娉ㄦ槑 fork 鏉ユ簮**

- [ ] **Step 5: 鍐?README.md 楠ㄦ灦(瀹氫綅/瀹夎/閰嶇疆鎸囧悜 spec)**

- [ ] **Step 6: 楠岃瘉楠ㄦ灦鍙姞杞?*

Run: `node --check src/index.mjs && node --check client.js`
Expected: 鏃犺緭鍑?exit 0

- [ ] **Step 7: git init 骞舵彁浜?*

```bash
cd C:\Users\LIULU\Desktop\dsh-approval-core
git init
git add -A
git commit -m "chore: fork dsh-approval-gate 0.5.0 as dsh-approval-core skeleton"
```

---


