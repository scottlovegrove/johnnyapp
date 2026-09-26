import 'reflect-metadata'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Token and project files are read from the config dir at import time, so
// every test run gets its own empty one and never touches ~/.config/johnny.
process.env.JOHNNY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'johnny-test-'))
delete process.env.JOHNNY_TOKEN
