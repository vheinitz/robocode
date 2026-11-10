# robopy — EeZear-Stil fuer MicroPython (ESP32), OHNE Transpiler.
#
# Vorbild: die Arduino-Lib EeZear (C++). Gleiche Rollen, gleiche Kindlogik — nur
# dass die kindgerechte "Sprache" hier eine reine Python-Bibliothek ist, die der
# ESP32 direkt ausfuehrt. Kein Zwischenformat, keine Uebersetzung.
#
#   Rolle   EeZear (C++)            robopy (Python)
#   -----   --------------------    -----------------------------
#   DO      DO13 / EEZ_DO(LED,13)   LED = DO(13)
#   DI      DI / EEZ_DI             s = DI(4)
#   DIPU    DIPU / EEZ_DI_PULLUP    s = DIPU(7)
#   BTN     BTN (PU+inv+entprellt)  b = BTN(2)
#   AIN     Ax (0..255)             p = AIN(0)
#   PWM     PWM3..                  m = PWM(5)
#   EVERY   every(ms){ }            t = Every(ms); if t.due: ...
#
# Kurzform (statt Methodenaufruf mit Klammern):
#   schreiben   LED.v = 1      <- EeZears `DO13 = HIGH`. Python kann `=` auf einen
#               LED.on()          nackten Namen NICHT ueberladen; `.v =` (Property-
#               LED(1)            Setter) ist die naechstbeste Stufe.
#   lesen       if BTN:        <- __bool__  (bloße Referenz = aktiv/gedrueckt)
#               x = POT.v         @property  (ohne Klammern)
#
# Dieselbe Datei laeuft auf dem ESP32 (echtes `machine`) UND am PC (CPython-
# Ersatz mit kleiner Simulation, damit man es ohne Hardware sieht).

try:
    # --- Echtes Backend: MicroPython auf dem ESP32 ---
    from machine import Pin, ADC, PWM as _MPWM
    import time

    SIM = False
    ticks_ms = time.ticks_ms
    ticks_diff = time.ticks_diff

    def sleep_ms(ms):
        time.sleep_ms(ms)

    _cache = {}

    def _din(pin, pull_up):
        p = _cache.get(("in", pin))
        if p is None:  # faule Initialisierung (wie EeZear: Modus bei erster Nutzung)
            p = Pin(pin, Pin.IN, Pin.PULL_UP if pull_up else None)
            _cache[("in", pin)] = p
        return p.value()

    def _dout(pin, val):
        p = _cache.get(("out", pin))
        if p is None:
            p = Pin(pin, Pin.OUT)
            _cache[("out", pin)] = p
        p.value(val)

    def _ain_raw(pin):
        a = _cache.get(("adc", pin))
        if a is None:
            a = ADC(Pin(pin))
            _cache[("adc", pin)] = a
        return a.read_u16() >> 4  # 0..65535 -> 0..4095

    def _pwm(pin, duty_1023, freq):
        p = _cache.get(("pwm", pin))
        if p is None:
            p = _MPWM(Pin(pin))
            p.freq(freq)
            _cache[("pwm", pin)] = p
        p.duty(duty_1023)  # ESP32: 10-Bit 0..1023

    def _register_in(label, fn):
        pass

    def _label_out(pin, label):
        pass

except ImportError:
    # --- Ersatz-Backend: CPython am PC, reine Simulation ---
    SIM = True

    _TICK = {"n": 0}
    _BUDGET = {"n": 12}
    _INPUTS = []   # (label, read_fn)
    _OUT = {}      # pin -> wert
    _OUTLBL = {}   # pin -> label

    def ticks_ms():
        return _TICK["n"] * 50  # 50 ms je Simulationsschritt

    def ticks_diff(a, b):
        return a - b

    # Gescriptete Eingaenge, damit alle Zweige drankommen.
    def _sim_button(pin, tick):
        return 0 if tick in (2, 3) else 1  # Pegel: 0 = gedrueckt (active-low)

    def _sim_ain_pct(pin, tick):
        seq = [0, 0, 0, 0, 20, 85, 95, 80, 60, 40, 20, 10, 0, 0]
        return seq[min(tick, len(seq) - 1)]

    def _din(pin, pull_up):
        return _sim_button(pin, _TICK["n"])

    def _dout(pin, val):
        _OUT[pin] = val

    def _ain_raw(pin):
        return int(_sim_ain_pct(pin, _TICK["n"]) / 100 * 4095)

    def _pwm(pin, duty_1023, freq):
        _OUT[pin] = round(duty_1023 / 1023 * 255)

    def _register_in(label, fn):
        _INPUTS.append((label, fn))

    def _label_out(pin, label):
        _OUTLBL[pin] = label
        _OUT.setdefault(pin, 0)

    def _render():
        ins = "  ".join("%s=%s" % (l, f()) for l, f in _INPUTS)
        outs = "  ".join(
            "%s=%d" % (_OUTLBL.get(p, "pin%d" % p), v) for p, v in sorted(_OUT.items())
        )
        print("t=%4dms | ein: %-20s | aus: %s" % (ticks_ms(), ins, outs))

    def sleep_ms(ms):
        _render()
        _TICK["n"] += 1
        _BUDGET["n"] -= 1
        if _BUDGET["n"] < 0:
            print("— Simulation beendet (am ESP32 liefe die Schleife endlos) —")
            raise SystemExit


# ===========================================================================
# _Readable: macht ein Lese-Objekt im Ausdruck wie seine Zahl nutzbar -> KEIN
# .v noetig. `if poti > 70:` , `a = taster` , `dimmer.v = poti`. Unterklassen
# liefern _num(). (MicroPython unterstuetzt Vergleichs-/Arithmetik-Dunders und
# __bool__; Setter nutzen zusaetzlich _val(), um nicht auf __int__ angewiesen zu
# sein.)
# ===========================================================================

class _Readable:
    def _num(self):
        raise NotImplementedError

    def __int__(self):
        return int(self._num())

    def __index__(self):
        return int(self._num())

    def __float__(self):
        return float(self._num())

    def __bool__(self):
        return bool(self._num())

    def __lt__(self, o):
        return self._num() < _val(o)

    def __le__(self, o):
        return self._num() <= _val(o)

    def __gt__(self, o):
        return self._num() > _val(o)

    def __ge__(self, o):
        return self._num() >= _val(o)

    def __eq__(self, o):
        return self._num() == _val(o)

    def __ne__(self, o):
        return self._num() != _val(o)

    def __add__(self, o):
        return self._num() + _val(o)

    def __radd__(self, o):
        return _val(o) + self._num()

    def __sub__(self, o):
        return self._num() - _val(o)

    def __rsub__(self, o):
        return _val(o) - self._num()

    def __mul__(self, o):
        return self._num() * _val(o)

    def __rmul__(self, o):
        return _val(o) * self._num()

    def __floordiv__(self, o):
        return self._num() // _val(o)

    def __mod__(self, o):
        return self._num() % _val(o)

    def __repr__(self):
        return str(self._num())

    def __hash__(self):         # trotz __eq__ hashbar bleiben (MicroPython-sicher;
        return id(self)         # object.__hash__ gibt es in MicroPython nicht)


def _val(x):
    # Zahl aus einem Lese-Objekt holen (damit DO.v = poti ohne .v geht).
    return x._num() if isinstance(x, _Readable) else x


# ===========================================================================
# Digitale Eingaenge: DI (direkt), DIPU (Pull-Up), BTN (PU + invertiert +
# entprellt). Fluente Konfiguration wie EeZears .setMode/.setInverted/.setDebounce.
# ===========================================================================

class _DigitalIn(_Readable):
    def __init__(self, pin, pull_up=False, inverted=False, debounce_ms=0, name=None):
        self._pin = pin
        self._pull = pull_up
        self._inv = inverted
        self._db = debounce_ms
        self._name = name or ("DI@%d" % pin)
        self._stable = None
        self._last = None
        self._last_t = 0
        if SIM:
            _register_in(self._name, lambda: self.v)

    # fluente Konfiguration (Rueckgabe self -> verkettbar)
    def set_mode(self, pull_up):
        self._pull = pull_up
        return self

    def set_inverted(self, v=True):
        self._inv = v
        return self

    def set_debounce(self, ms):
        self._db = ms
        return self

    def _raw(self):
        lvl = _din(self._pin, self._pull)
        active = (lvl == 0) if self._inv else (lvl == 1)
        return active

    def _read(self):
        r = self._raw()
        if self._db <= 0:
            return r
        now = ticks_ms()
        if r != self._last:                 # Flanke: Timer neu starten
            self._last = r
            self._last_t = now
        elif ticks_diff(now, self._last_t) >= self._db:
            self._stable = r                # lange genug stabil -> uebernehmen
        if self._stable is None:
            self._stable = r
        return self._stable

    def _num(self):         # 0/1 für _Readable (if btn / a = btn / btn > 0)
        return 1 if self._read() else 0

    @property
    def p(self):            # klammerlos: if btn.p
        return self._read()

    @property
    def v(self):            # 0/1 (explizit)
        return 1 if self._read() else 0

    def __call__(self):     # btn()
        return self._read()


def DI(pin, name=None):
    return _DigitalIn(pin, pull_up=False, inverted=False, name=name)


def DIPU(pin, name=None):
    return _DigitalIn(pin, pull_up=True, inverted=False, name=name)


def BTN(pin, name=None):
    # EeZear-BTN-Vorgabe: Pull-Up + invertierte Logik + 20 ms Entprellung.
    return _DigitalIn(pin, pull_up=True, inverted=True, debounce_ms=20, name=name)


# ===========================================================================
# Digitaler Ausgang: DO.  Kurzform: LED.v = 1  (EeZears DO13 = HIGH).
# ===========================================================================

class _DigitalOut:
    def __init__(self, pin, inverted=False, name=None):
        self._pin = pin
        self._inv = inverted  # aktiv-low (z. B. LED mit Anode an VCC)
        self._state = 0
        if SIM:
            _label_out(pin, name or ("DO@%d" % pin))
        self._apply()

    def _apply(self):
        _dout(self._pin, (1 - self._state) if self._inv else self._state)

    def on(self):
        self._state = 1
        self._apply()

    def off(self):
        self._state = 0
        self._apply()

    def toggle(self):
        self._state = 0 if self._state else 1
        self._apply()

    @property
    def v(self):
        return self._state

    @v.setter
    def v(self, x):          # LED.v = 1  (oder LED.v = taster  -> ohne .v lesbar)
        self._state = 1 if _val(x) else 0
        self._apply()

    def __call__(self, x=None):   # LED(1) / LED()
        if x is None:
            return self._state
        self.v = x

    def __bool__(self):
        return bool(self._state)


def DO(pin, name=None):
    return _DigitalOut(pin, name=name)


class _Pin(_Readable):
    """Vordefinierter Pin (D0..Dn). Richtung wird LAZY bei erster Nutzung
    festgelegt: `D13.v = 1` / `D13.on()` -> Ausgang; `if D13:` / `a = D13` ->
    Eingang. So kann man jeden Board-Pin ohne vorherige Definition nutzen."""

    def __init__(self, gpio, name=None):
        self._pin = gpio
        self._out = False
        self._state = 0
        self._name = name or ("D%d" % gpio)

    def _num(self):                      # lesen -> Eingang
        if self._out:
            return self._state
        return 1 if _din(self._pin, False) else 0

    def _write(self, x):                 # schreiben -> Ausgang
        if not self._out and SIM:
            _label_out(self._pin, self._name)
        self._out = True
        self._state = 1 if _val(x) else 0
        _dout(self._pin, self._state)

    def on(self):
        self._write(1)

    def off(self):
        self._write(0)

    def toggle(self):
        self._write(0 if self._state else 1)

    @property
    def v(self):
        return self._num()

    @v.setter
    def v(self, x):
        self._write(x)

    def __call__(self, x=None):
        if x is None:
            return self._num()
        self._write(x)


def D(gpio, name=None):
    return _Pin(gpio, name=name)


# ===========================================================================
# Analogeingang: AIN. Vorgabe-Skala 0..255 wie EeZears Ax (per set_range aenderbar).
# ===========================================================================

class _AnalogIn(_Readable):
    def __init__(self, pin, lo=0, hi=255, name=None):
        self._pin = pin
        self._lo = lo
        self._hi = hi
        self._name = name or ("AIN@%d" % pin)
        if SIM:
            _register_in(self._name, lambda: self.v)

    def set_range(self, lo, hi):
        self._lo = lo
        self._hi = hi
        return self

    def _num(self):         # für _Readable: pot > 70 / a = pot / dimmer.v = pot
        return self._lo + round(_ain_raw(self._pin) / 4095 * (self._hi - self._lo))

    @property
    def v(self):            # klammerlos auch explizit: x = pot.v
        return self._num()

    @property
    def raw(self):
        return _ain_raw(self._pin)

    def __call__(self):
        return self.v


def AI(pin, lo=0, hi=255, name=None):   # AI = Analogeingang (Kern-Begriff)
    return _AnalogIn(pin, lo, hi, name=name)


AIN = AI  # Alias


# ===========================================================================
# PWM-Ausgang: PWM. Kurzform: m.v = 128  (0..255, intern auf 0..1023 skaliert).
# ===========================================================================

class _PwmOut:
    def __init__(self, pin, freq=1000, name=None):
        self._pin = pin
        self._freq = freq
        self._duty = 0
        if SIM:
            _label_out(pin, name or ("PWM@%d" % pin))
        self._apply()

    def _apply(self):
        _pwm(self._pin, round(self._duty / 255 * 1023), self._freq)

    @property
    def v(self):
        return self._duty

    @v.setter
    def v(self, x):          # dimmer.v = 128  oder  dimmer.v = poti
        self._duty = max(0, min(255, int(_val(x))))
        self._apply()

    def __call__(self, x=None):
        if x is None:
            return self._duty
        self.v = x


def PWM(pin, freq=1000, name=None):
    return _PwmOut(pin, freq, name=name)


AO = PWM  # AO = Analog-Out (PWM), Gegenstück zu AI


# ===========================================================================
# Motor an H-Bruecke (2 PWM-Pins, optional En/Dis). Kurzform: m.v = 80  (-100..100).
# (EeZear kennt keinen Motor; gehoert aber zu robocodes Geraetepalette.)
# ===========================================================================

class _Motor:
    def __init__(self, a, b, en=None, freq=1000, name=None):
        self._a = _PwmOut(a, freq, name=(name or "MOT") + ".a")
        self._b = _PwmOut(b, freq, name=(name or "MOT") + ".b")
        self._en = _DigitalOut(en, name=(name or "MOT") + ".en") if en is not None else None
        if self._en:
            self._en.on()

    def speed(self, pct):               # -100..100 (auch motor.speed(poti))
        pct = max(-100, min(100, _val(pct)))
        duty = round(abs(pct) / 100 * 255)
        if pct >= 0:
            self._a.v = duty
            self._b.v = 0
        else:
            self._a.v = 0
            self._b.v = duty

    @property
    def v(self):
        return self._a.v - self._b.v

    @v.setter
    def v(self, pct):                   # m.v = 80
        self.speed(pct)

    def stop(self):
        self._a.v = 0
        self._b.v = 0

    def brake(self):
        self._a.v = 255
        self._b.v = 255


def Motor(a, b, en=None, freq=1000, name=None):
    return _Motor(a, b, en, freq, name=name)


# ===========================================================================
# Nicht-blockierender Takt (EeZears EVERY).  if blink.due: ...
# ===========================================================================

class Every:
    def __init__(self, ms):
        self._ms = ms
        self._last = ticks_ms()

    @property
    def due(self):
        now = ticks_ms()
        if ticks_diff(now, self._last) >= self._ms:
            self._last = now
            return True
        return False


# ===========================================================================
# Synonyme/Wrapper über DI/DO/AI — nur andere Namen (teils umgedrehte Logik).
# Kinder sehen vertraute Begriffe; darunter steckt dieselbe DI/DO/AI-Basis.
# ===========================================================================

def LED(pin, inverted=False, name=None):
    # LED = Digitalausgang. inverted=True für aktiv-low (Anode an VCC).
    return _DigitalOut(pin, inverted=inverted, name=name or ("LED@%d" % pin))


TASTER = BTN   # Taster = DI mit Pull-Up + invertiert + entprellt
MOTOR = Motor  # Motor = Wrapper über zwei Ausgänge (H-Brücke)
wait = sleep_ms  # kindgerechter Alias: wait(500) statt sleep_ms(500)


# ===========================================================================
# RGB — adressierbare WS2812/NeoPixel-LED (z. B. die Onboard-LED vieler
# ESP32-C3-Boards, oft an GPIO2 oder GPIO8). Nutzt MicroPythons neopixel-Modul.
#   rgb = RGB(2)
#   rgb.color(255, 0, 0)   # rot     (auch rgb.color(poti, 0, 0))
#   rgb.off()
# ===========================================================================

# Farbnamen (deutsch + englisch) -> (r, g, b).
_COLORS = {
    "rot": (255, 0, 0), "red": (255, 0, 0),
    "gruen": (0, 255, 0), "grün": (0, 255, 0), "green": (0, 255, 0),
    "blau": (0, 0, 255), "blue": (0, 0, 255),
    "gelb": (255, 255, 0), "yellow": (255, 255, 0),
    "orange": (255, 80, 0),
    "lila": (255, 0, 255), "magenta": (255, 0, 255),
    "cyan": (0, 255, 255),
    "weiss": (255, 255, 255), "weiß": (255, 255, 255), "white": (255, 255, 255),
    "aus": (0, 0, 0), "schwarz": (0, 0, 0), "off": (0, 0, 0), "black": (0, 0, 0),
}


class _Rgb:
    def __init__(self, pin, n=1, name=None):
        self._pin = pin
        self._n = n
        self._name = name or ("RGB@%d" % pin)
        self._last = (0, 0, 0)
        if not SIM:
            from machine import Pin as _P
            import neopixel
            self._np = neopixel.NeoPixel(_P(pin), n)
        else:
            self._np = None  # am PC nur gemerkt, keine echte LED

    def color(self, r, g=None, b=None):
        # Farbname (rgb.color("rot")) ODER drei Zahlen (rgb.color(255, 0, 0)).
        if isinstance(r, str):
            r, g, b = _COLORS.get(r.lower(), (0, 0, 0))
        self._last = (int(_val(r)) & 255, int(_val(g)) & 255, int(_val(b)) & 255)
        if not SIM:
            for i in range(self._n):
                self._np[i] = self._last
            self._np.write()

    def off(self):
        self.color(0, 0, 0)

    @property
    def v(self):
        return self._last

    @v.setter
    def v(self, rgb):       # rgb.v = (255, 0, 0)
        self.color(rgb[0], rgb[1], rgb[2])


def RGB(pin, n=1, name=None):
    return _Rgb(pin, n, name=name)
