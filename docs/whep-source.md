# WHEP test source

Example on how to generate a local WHEP test source.

First download and install the application `srt-whep`:

```
cargo install srt_whep
```

Generate an SRT test stream:

```
docker run --rm --name=testsrc -d -p 5678:1234/udp eyevinntechnology/testsrc
```

Run `srt-whep` to provide a WHEP version of the SRT stream

```
srt-whep -i 127.0.0.1:5678 -o 0.0.0.0:8888 -p 8000 -s caller
```

Then a local WHEP test source is available at `http://localhost:8000/channel`
