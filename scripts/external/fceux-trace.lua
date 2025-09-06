-- FCEUX Lua script: step-by-step CPU trace to a log file.
-- Usage inside FCEUX (provided by wrapper):
--   fceux --nogui --autoexit <rom> --loadlua scripts/external/fceux-trace.lua -- <outPath> <seconds> <maxInstr> [startPChex]
-- Notes:
-- - Requires FCEUX 2.5+ with Lua support and debugger.step().
-- - We only log PC/A/X/Y/P/SP; CYC may not be available; comparator treats cycles as optional.
-- - If startPChex is provided (e.g., C000), we set PC to that before stepping.

local args = {...}
-- Prefer environment variables set by the wrapper; fall back to args; finally defaults.
local outPath = os.getenv('FCEUX_OUT') or args[1] or 'out/external-fceux.log'
local seconds = tonumber(os.getenv('FCEUX_SECONDS') or args[2] or '0') or 0
local maxInstr = tonumber(os.getenv('FCEUX_MAX') or args[3] or '0') or 0
local startPChex = os.getenv('FCEUX_START') or args[4]

local function now_sec()
  -- os.time returns integer seconds; sufficient for coarse time limit.
  return os.time()
end

local function read_reg(name)
  local v = nil
  if debugger and debugger.getregister then v = debugger.getregister(name) end
  if v == nil and emu and emu.getregister then v = emu.getregister(name) end
  if type(v) ~= 'number' then return 0 end
  return v
end

local function set_reg(name, v)
  if debugger and debugger.setregister then pcall(function() debugger.setregister(name, v) end) return end
  if emu and emu.setregister then pcall(function() emu.setregister(name, v) end) return end
end

local function fmt2(v)
  v = v & 0xFF
  local s = string.format('%02X', v)
  return s
end

local function fmt4(v)
  v = v & 0xFFFF
  local s = string.format('%04X', v)
  return s
end

-- Optional: set starting PC (common for nestest)
if startPChex and #startPChex > 0 then
  local pc = tonumber(startPChex, 16)
  if pc then set_reg('pc', pc & 0xFFFF) end
end

if print then print(string.format('[lua] tracer start out=%s sec=%d max=%d start=%s', tostring(outPath), seconds, maxInstr, tostring(startPChex))) end
if emu and emu.print then pcall(function() emu.print('[lua] tracer running') end) end

-- Open output file
local ok, fh = pcall(function() return io.open(outPath, 'w') end)
if not ok or fh == nil then
  if print then print(string.format('ERROR: cannot open %s for write', tostring(outPath))) end
  if emu and emu.print then pcall(function() emu.print('ERROR opening out file') end) end
  return
end

local deadline = seconds > 0 and (now_sec() + math.floor(seconds)) or math.huge
local count = 0

-- Emit lines until time or maxInstr reached. Each iteration logs the pre-step state, then steps.
while true do
  if maxInstr > 0 and count >= maxInstr then break end
  if now_sec() >= deadline then break end

  local pc = read_reg('pc')
  local a  = read_reg('a')
  local x  = read_reg('x')
  local y  = read_reg('y')
  local p  = read_reg('p')
  local s  = read_reg('s')

  -- Minimal nestest-like format (no CYC): "PC ... A:.. X:.. Y:.. P:.. SP:.."
  local line = string.format('%s  --              A:%s X:%s Y:%s P:%s SP:%s',
    fmt4(pc), fmt2(a), fmt2(x), fmt2(y), fmt2(p), fmt2(s))
  fh:write(line .. '\n')

  -- Step one instruction via debugger API
  if debugger and debugger.step then
    debugger.step()
  else
    -- If debugger.step is not available, try advancing a frame.
    if emu and emu.frameadvance then emu.frameadvance() end
  end

  count = count + 1
end

fh:flush()
fh:close()

-- Try to request emulator exit if available; wrapper also enforces a timeout.
if emu and emu.pause then pcall(function() emu.pause() end) end
if emu and emu.exit then pcall(function() emu.exit() end) end

