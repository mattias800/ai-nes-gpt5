-- scripts/nestest_mame_auto.lua
-- Run nestest in "auto" mode in MAME without manual interaction.
-- Actions:
--  - Set CPU PC to $C000 (auto mode entry)
--  - Start a CPU trace to nestest-mame.log
--  - Stop the trace automatically when $6000 status changes from 0x80 (running)
--    or after a max frame budget to keep logs bounded
-- Usage:
--  mame nes -cart /path/to/nestest.nes -debug -autoboot_script scripts/nestest_mame_auto.lua -nothrottle -nowindow

local TARGET_PC = 0xC000
local TRACE_FILE = "nestest-mame.log"
local MAX_FRAMES = 600 -- safety stop if ROM never toggles $6000

local started = false
local stopped = false
local frame0 = nil

local function get_cpu()
  return manager.machine.devices[":maincpu"]
end

local function program_space()
  return get_cpu().spaces["program"]
end

local function read_u8(addr)
  return program_space():read_u8(addr & 0xFFFF)
end

local function set_pc(pc)
  -- Set 6502 PC register via device state
  local cpu = get_cpu()
  local st = cpu.state
  st["PC"] = pc & 0xFFFF
end

local function start_trace()
  debugger.command(string.format("trace %s,maincpu", TRACE_FILE))
end

local function stop_trace()
  debugger.command("trace off")
end

emu.register_frame(function()
  local fnum = manager.machine.video.frame_number
  if frame0 == nil then frame0 = fnum end

  if not started and fnum >= (frame0 + 3) then
    -- After a few frames to let machine stabilize, set PC and start trace
    set_pc(TARGET_PC)
    start_trace()
    emu.print(string.format("[nestest_mame_auto] PC set to $%04X, trace -> %s", TARGET_PC, TRACE_FILE))
    started = true
  end

  if started and not stopped then
    -- Monitor $6000 status: many blargg-style harnesses set 0x80 while running, other when done
    local status = read_u8(0x6000)
    if status ~= 0x80 and status ~= 0x00 then
      stop_trace()
      emu.print(string.format("[nestest_mame_auto] status=$%02X @frame=%d -> trace stopped", status & 0xFF, fnum))
      emu.pause()
      stopped = true
      return
    end
    -- Safety stop
    if fnum - frame0 > MAX_FRAMES then
      stop_trace()
      emu.print(string.format("[nestest_mame_auto] safety stop at frame=%d", fnum))
      emu.pause()
      stopped = true
      return
    end
  end
end)

