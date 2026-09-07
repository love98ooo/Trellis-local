# Continue Current Work

```bash
python3 ./.trellis/scripts/get_context.py
python3 ./.trellis/scripts/get_context.py --mode phase
```

Resume from the current request, recorded progress and existing authorization according to `.trellis/workflow.md`. Load the needed step rather than repeating completed work:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform opencode
```
