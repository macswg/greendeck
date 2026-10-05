# Builds the greendeck COMP in the open TouchDesigner project. Run it from the
# Textport:
#
#   exec(open(__import__('os').path.expanduser('~/git/greendeck/td/install.py')).read())
#
# Safe to re-run: it rebuilds the COMP's internals but keeps the bindings table.

import os

GREENDECK_TD_DIR = os.path.expanduser('~/git/greendeck/td')
DECK_PORT = 9900  # where the deck listens (td.<name> <value>)
TD_PORT = 9901    # where TD listens (set / pulse / sync)


def _try_set(o, name, value):
	par = getattr(o.par, name, None)
	if par is not None:
		par.val = value


def install_greendeck(parent_path='/project1'):
	root = op(parent_path)
	gd = root.op('greendeck') or root.create(baseCOMP, 'greendeck')

	bindings = gd.op('bindings') or gd.create(tableDAT, 'bindings')
	if bindings[0, 0] is None or bindings[0, 0].val != 'name':
		bindings.clear()
		bindings.appendRow(['name', 'path', 'par'])
		bindings.appendRow(['record', '', ''])
		bindings.appendRow(['cacherecord', '', ''])

	link = gd.op('link') or gd.create(textDAT, 'link')
	link.par.file = os.path.join(GREENDECK_TD_DIR, 'link.py')
	link.par.syncfile = True

	udpout = gd.op('udpout') or gd.create(udpoutDAT, 'udpout')
	udpout.par.address = '127.0.0.1'
	udpout.par.port = DECK_PORT

	udpin = gd.op('udpin') or gd.create(udpinDAT, 'udpin')
	udpin.par.port = TD_PORT
	# UDP In defaults to one row/callback per message, which link.receive expects.
	_try_set(udpin, 'maxlines', 10)
	callbacks = gd.op('udpin_callbacks') or gd.create(textDAT, 'udpin_callbacks')
	callbacks.text = (
		"def onReceive(dat, rowIndex, message, byteData, peer):\n"
		"\top('link').module.receive(message)\n"
	)
	udpin.par.callbacks = callbacks.name

	frame = gd.op('frame') or gd.create(executeDAT, 'frame')
	frame.text = (
		"def onFrameEnd(frame):\n"
		"\top('link').module.poll()\n"
	)
	frame.par.frameend = True
	frame.par.active = True

	for i, o in enumerate([bindings, link, udpin, callbacks, frame, udpout]):
		o.nodeX, o.nodeY = (i % 3) * 200, -(i // 3) * 150
	print('greendeck installed at', gd.path, '- fill in', bindings.path)
	return gd


install_greendeck()
