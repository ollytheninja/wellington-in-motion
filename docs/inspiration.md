# Inspiration

Source: https://lnkd.in/p/ey5qq6ds

An animation of every train in the Netherlands on a map across 24 hours.

## What we want to borrow

- Dark background. The network is only visible where trains have been.
- Each train is a glowing dot with a fading light trail behind it.
- Overlapping trails add up in brightness, so busy corridors light up and quiet ones stay dim. This is the Gource look.
- Time is fast (a full day in roughly a minute or two), so the rhythm of the day shows: the empty small hours, the peaks, the evening tail.

## What we add

- A scrubber. The timelapse is the default state, but you can pause, drag to any time, and change the speed.
- Zoom and pan on a real map, so you can follow one line.

## Look, in concrete terms

- Background near black with a slight blue tint. Land slightly lighter than sea, or the reverse, but very low contrast.
- Rail lines drawn as thin, dim strokes so the empty network is faintly visible.
- One colour per line, saturated, blended additively so overlaps go white.
- Trails fade with an exponential falloff over a fixed length of simulated time (start at about 5 minutes).
- A soft bloom on the dots. Cheap version: a large low-alpha circle under a small bright one.
