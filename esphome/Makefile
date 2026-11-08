CONFIG ?= sky-toppower-psu
DEVICE ?=  # Set the target with make DEVICE=<target>

.DEFAULT_GOAL := run

PANEL := web/panel.html
GEN   := web/panel_html_gz.h

.PHONY: run logs compile upload clean gen check-device

$(GEN): $(PANEL) web/panel_handler.h web/gen_panel.py
	python3 web/gen_panel.py

gen: $(GEN)

check-device:
	@test -n "$(DEVICE)" || { echo "Set DEVICE=<target> before running this target." >&2; exit 1; }

run: check-device gen
	timeout 600 esphome run $(CONFIG).yaml --device $(DEVICE) --no-logs

compile: gen
	esphome compile $(CONFIG).yaml

logs: check-device
	timeout 14 esphome logs $(CONFIG).yaml --device $(DEVICE)

clean:
	esphome clean $(CONFIG).yaml
