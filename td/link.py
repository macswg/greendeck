# greendeck link: the TouchDesigner side of the Stream Deck control surface.
#
# Lives in the greendeck COMP as the Text DAT "link" (file-synced to this
# file). The "bindings" Table DAT maps names the deck uses to parameters:
#
#   name          path                 par
#   record        /project1/moviout    record
#   cacherecord   /project1/cache1     active
#
# Deck -> TD (udpin, port 9901):  set <name> <value> | pulse <name> | sync
# TD -> deck (udpout, port 9900): td.<name> <value>, sent whenever a bound
# value changes (from the deck, the UI, or a script), plus td.alive on sync.


def _binding(name):
	table = op('bindings')
	row = table.row(name) if table else None
	if not row:
		return None
	target = op(row[1].val.strip()) if len(row) > 1 else None
	return getattr(target.par, row[2].val.strip(), None) if target and len(row) > 2 else None


def _bindings():
	table = op('bindings')
	for row in table.rows()[1:]:
		name = row[0].val.strip()
		if name:
			yield name, _binding(name)


def _fmt(value):
	if isinstance(value, bool):
		return str(int(value))
	if isinstance(value, float):
		return '{:g}'.format(value)
	return str(value)


def _coerce(par, raw):
	if par.isToggle:
		return raw.lower() not in ('0', '', 'false', 'off')
	if par.isNumber:
		return int(float(raw)) if par.isInt else float(raw)
	return raw


def _send(lines):
	if lines:
		op('udpout').send('\n'.join(lines))


def _last():
	return parent().fetch('greendeck_last', {}, storeDefault=True)


def poll():
	"""Called every frame by the frame DAT: push any changed values."""
	last = _last()
	changed = []
	for name, par in _bindings():
		if par is None:
			continue
		value = _fmt(par.eval())
		if last.get(name) != value:
			last[name] = value
			changed.append('td.{} {}'.format(name, value))
	_send(changed)


def sync():
	lines = ['td.alive 1']
	for name, par in _bindings():
		if par is not None:
			lines.append('td.{} {}'.format(name, _fmt(par.eval())))
	_send(lines)


def receive(message):
	for line in message.splitlines():
		parts = line.strip().split(None, 2)
		if not parts:
			continue
		cmd = parts[0]
		if cmd == 'sync':
			sync()
			continue
		par = _binding(parts[1]) if len(parts) > 1 else None
		if par is None:
			debug('greendeck: no binding for', line)
		elif cmd == 'pulse' or (cmd == 'set' and par.isPulse):
			par.pulse()
		elif cmd == 'set' and len(parts) == 3:
			par.val = _coerce(par, parts[2])
