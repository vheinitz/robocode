# robolang HAL — Hardware-Abstraktion fuer ESP32 / MicroPython.
#
# Diese Datei ist die EINE Bibliothek, die beim Zusammenbau komplett in die
# erzeugte main.py eingebettet wird (kein Modul-Management auf dem ESP32).
# Lesbarkeit ist zweitrangig; die Klassen kapseln die impliziten
# Hardware-Annahmen, damit der Nutzer nur Pins vergibt — keine Elektronik.
#
# Namenskonvention (Zuordnung HW-Block -> Code):
#   HW-Block-Typ   -> Klasse        Button | Led | Ain | Motor
#   HW-Block-Name  -> Instanz       slug(Name).lower()   z. B. "START" -> start
#   Block-Attribut -> Methode       feste Vokabeln je Typ (s. u.)

from machine import Pin, ADC, PWM
from time import ticks_ms, ticks_diff


class Button:
    """Taster, immer gegen Masse, interner Pull-Up, entprellt (active-low).

    Methoden: pressed() -> gedrueckt (True solange gehalten),
              was_clicked() -> True einmal pro neuer Druck-Flanke.
    """

    def __init__(self, pin, debounce_ms=20):
        self._p = Pin(pin, Pin.IN, Pin.PULL_UP)  # offen = HIGH, gedrueckt = LOW
        self._db = debounce_ms
        self._stable = self._raw()
        self._last = self._stable
        self._t = ticks_ms()
        self._prev = self._stable

    def _raw(self):
        return self._p.value() == 0  # active-low: gedrueckt -> True

    def _update(self):
        r = self._raw()
        if r != self._last:
            self._last = r
            self._t = ticks_ms()
        elif ticks_diff(ticks_ms(), self._t) >= self._db:
            self._stable = r
        return self._stable

    def pressed(self):
        return self._update()

    def was_clicked(self):
        now = self._update()
        edge = now and not self._prev
        self._prev = now
        return edge


class Led:
    """LED, Anode am Pin (active-high), Vorwiderstand implizit.

    Methoden: on(), off(), toggle(), set(x).
    """

    def __init__(self, pin):
        self._p = Pin(pin, Pin.OUT)
        self._p.value(0)
        self._state = 0

    def on(self):
        self._state = 1
        self._p.value(1)

    def off(self):
        self._state = 0
        self._p.value(0)

    def set(self, x):
        self._state = 1 if x else 0
        self._p.value(self._state)

    def toggle(self):
        self.set(0 if self._state else 1)


class Din:
    """Digitaleingang (generisch). value() -> 0/1."""

    def __init__(self, pin, pull=None):
        if pull == "up":
            self._p = Pin(pin, Pin.IN, Pin.PULL_UP)
        elif pull == "down":
            self._p = Pin(pin, Pin.IN, Pin.PULL_DOWN)
        else:
            self._p = Pin(pin, Pin.IN)

    def value(self):
        return self._p.value()

    def is_high(self):
        return self._p.value() == 1

    def is_low(self):
        return self._p.value() == 0


class Dout:
    """Digitalausgang (generisch). on()/off()/toggle()/set(x)."""

    def __init__(self, pin):
        self._p = Pin(pin, Pin.OUT)
        self._p.value(0)
        self._state = 0

    def on(self):
        self._state = 1
        self._p.value(1)

    def off(self):
        self._state = 0
        self._p.value(0)

    def set(self, x):
        self._state = 1 if x else 0
        self._p.value(self._state)

    def toggle(self):
        self.set(0 if self._state else 1)

    def value(self):
        return self._state


class Ain:
    """Analoger Eingang (ADC) mit implizitem Spannungsteiler, skaliert 0..100 %.

    Methoden: value() -> 0..100 (Prozent), raw() -> 0..4095 (roh).
    """

    def __init__(self, pin):
        self._adc = ADC(Pin(pin))
        try:
            self._adc.atten(ADC.ATTN_11DB)  # Messbereich ~0..3.3 V
        except AttributeError:
            pass
        self._max = 4095

    def raw(self):
        return self._adc.read()

    def value(self):
        v = self.raw() * 100 // self._max
        return 100 if v > 100 else v


class Motor:
    """DC-Motor ueber eine H-Bruecke.

    Zwei Verdrahtungen:
      * 2 PWM-Pins (a, b): Richtung + Drehzahl ueber die beiden Kanaele
        (z. B. DRV8833/TB6612).
      * 2 PWM + 1 En/Dis (a, b, en): zusaetzliche Enable-Leitung
        (z. B. L298N ENA) zum harten Freigeben/Sperren.

    Methoden: speed(pct) -100..100, stop() (austrudeln), brake() (Kurzschluss),
              enable()/disable() (nur bei en-Pin wirksam).
    """

    def __init__(self, a, b, en=None, freq=1000):
        self._a = PWM(Pin(a), freq=freq, duty_u16=0)
        self._b = PWM(Pin(b), freq=freq, duty_u16=0)
        self._en = Pin(en, Pin.OUT) if en is not None else None
        if self._en is not None:
            self._en.value(1)  # standardmaessig freigegeben

    def _duty(self, pct):
        if pct < 0:
            pct = 0
        if pct > 100:
            pct = 100
        return pct * 65535 // 100

    def speed(self, pct):
        if pct > 100:
            pct = 100
        if pct < -100:
            pct = -100
        if pct >= 0:
            self._a.duty_u16(self._duty(pct))
            self._b.duty_u16(0)
        else:
            self._a.duty_u16(0)
            self._b.duty_u16(self._duty(-pct))

    def stop(self):
        self._a.duty_u16(0)
        self._b.duty_u16(0)

    def brake(self):
        self._a.duty_u16(65535)
        self._b.duty_u16(65535)

    def enable(self):
        if self._en is not None:
            self._en.value(1)

    def disable(self):
        if self._en is not None:
            self._en.value(0)

    # gleichnamige Aliase fuer robolang (.on/.off): Treiber freigeben/sperren
    def on(self):
        self.enable()

    def off(self):
        self.stop()
        self.disable()
