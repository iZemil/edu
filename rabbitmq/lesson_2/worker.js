var amqp = require("amqplib/callback_api");

amqp.connect(
    {
        username: "user",
        password: "password",
    },
    function (error0, connection) {
        if (error0) {
            throw error0;
        }
        connection.createChannel(function (error1, channel) {
            if (error1) {
                throw error1;
            }

            var queue = "task_queue";

            // This makes sure the queue is declared before attempting to consume from it
            channel.assertQueue(queue, {
                durable: true,
            });

            channel.prefetch(1);

            channel.consume(
                queue,
                function (msg) {
                    var secs = msg.content.toString().split(".").length - 1;

                    console.log(" [x] Received %s", msg.content.toString());
                    setTimeout(function () {
                        console.log(" [x] Done");
                        channel.ack(msg);
                    }, secs * 1000);
                },
                {
                    // manual acknowledgment mode,
                    // see /docs/confirms for details
                    noAck: false,
                }
            );
        });
    }
);
