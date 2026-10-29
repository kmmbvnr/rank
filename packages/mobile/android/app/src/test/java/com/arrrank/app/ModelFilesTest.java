package com.arrrank.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import java.io.EOFException;
import java.io.File;
import java.io.RandomAccessFile;
import java.util.Random;
import org.junit.Test;

public class ModelFilesTest {
    private static void writeBits(RandomAccessFile file, int bits) throws Exception {
        file.writeInt(Integer.reverseBytes(bits));
    }

    @Test public void preservesFiniteBitsAcrossChunksAndNonzeroOffset() throws Exception {
        File path = File.createTempFile("rank-tensor", ".bin");
        try (RandomAccessFile file = new RandomAccessFile(path, "rw")) {
            int[] bits = new int[32773]; // Two full 64 KiB chunks and a short tail.
            int[] edges = {0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000,
                0x7f7fffff, 0xff7fffff, 0x3f800000, 0xbf800000};
            Random random = new Random(1234);
            file.write(new byte[13]);
            for (int i = 0; i < bits.length; i++) {
                int value;
                do { value = random.nextInt(); } while ((value & 0x7f800000) == 0x7f800000);
                bits[i] = i < edges.length ? edges[i] : value;
                writeBits(file, bits[i]);
            }
            // The requested tensor must not consume an adjacent tensor's bytes.
            writeBits(file, 0x7fc00000);
            for (boolean profile : new boolean[] {false, true}) {
                file.seek(13);
                float[] actual = ModelFiles.readTensorData(file, bits.length,
                    profile ? new ModelFiles.TensorReadProfile() : null);
                assertEquals(13 + bits.length * 4L, file.getFilePointer());
                for (int i = 0; i < bits.length; i++) assertEquals("cell " + i, bits[i], Float.floatToRawIntBits(actual[i]));
            }
        } finally { path.delete(); }
    }

    @Test public void rejectsNonfiniteValuesIncludingChunkTail() throws Exception {
        File path = File.createTempFile("rank-tensor", ".bin");
        try (RandomAccessFile file = new RandomAccessFile(path, "rw")) {
            for (int value : new int[] {0x7fc00000, 0x7f800001, 0x7f800000, 0xff800000}) {
                for (int position : new int[] {0, 16384}) {
                    file.setLength(0);
                    for (int i = 0; i < position; i++) writeBits(file, 0x3f800000);
                    writeBits(file, value);file.seek(0);
                    assertThrows(IllegalArgumentException.class, () -> ModelFiles.readTensorData(file, position + 1, null));
                }
            }
        } finally { path.delete(); }
    }

    @Test public void rejectsTruncatedTail() throws Exception {
        File path = File.createTempFile("rank-tensor", ".bin");
        try (RandomAccessFile file = new RandomAccessFile(path, "rw")) {
            file.setLength(65539);file.seek(0);
            assertThrows(EOFException.class, () -> ModelFiles.readTensorData(file, 16385, null));
        } finally { path.delete(); }
    }
}
